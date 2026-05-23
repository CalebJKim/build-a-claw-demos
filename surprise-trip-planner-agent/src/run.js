#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from './demo-config.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
process.env.PATH = `${path.join(os.homedir(), '.npm-global', 'bin')}:${process.env.PATH ?? ''}`;

const DEFAULT_CONFIG = {
  model: 'unsloth/Qwen3.6-35B-A3B-GGUF',
  ollamaHost: 'http://127.0.0.1:8000/v1',
  temperature: 0.45,
  maxOutputTokens: 2048,
};

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    if (['help', 'skip-model'].includes(key)) {
      args[key] = true;
      continue;
    }
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

async function readConfig() {
  return loadRuntimeConfig(ROOT, DEFAULT_CONFIG);
}

function usage() {
  return `Usage:
  surprise-trip doctor
  surprise-trip run --brief "Plan a surprise weekend trip..." [--origin "San Francisco, CA"] [--budget 1200]

Options:
  --skip-model              Use deterministic reveal messages and summary.
  --model <name>            Model id override. Default from demo.config.json.
  --origin <place>          Departure city. Default from demo.config.json.
  --budget <amount>         Total budget in USD. Default parsed from brief or sample.
  --partner-name <name>     Partner name for reveal copy.
  --traveler-name <name>    User name for reveal copy.
  --dates <text>            Weekend timing or season.
  --out <path>              Output directory.
`;
}

function commandExists(command) {
  const result = spawnSync('bash', ['-lc', `command -v ${shellQuote(command)}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout ?? 120000,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || `${command} exited ${result.status}`;
    throw new Error(detail.trim());
  }
  return result.stdout;
}

function safeRunLabel(command, args) {
  try {
    return run(command, args).trim();
  } catch (error) {
    return `error: ${String(error.message).split(/\r?\n/)[0]}`;
  }
}

async function doctor(config) {
  const checks = [];
  let ok = true;
  checks.push(['node', process.version]);
  const openclawVersion = commandExists('openclaw') ? safeRunLabel('openclaw', ['--version']) : 'missing';
  const llamaServerOk = await fetchJson(`${config.ollamaHost}/models`, {}, 5000).then(() => 'ok').catch((e) => `error: ${e.message}`);
  const pythonPath = commandExists('python3') ?? 'missing';
  checks.push(['openclaw', openclawVersion]);
  checks.push(['llama-server', llamaServerOk]);
  checks.push(['python3', pythonPath]);
  checks.push(['travel-corpus', existsSync(path.join(ROOT, 'data/travel-corpus.json')) ? 'present' : 'missing']);
  checks.push(['mock-travel-search', existsSync(path.join(ROOT, 'tools/mock-travel-search')) ? 'present' : 'missing']);
  if (openclawVersion === 'missing' || llamaServerOk.startsWith('error:') || pythonPath === 'missing') ok = false;
  if (openclawVersion.startsWith('error:') || llamaServerOk.startsWith('error:')) ok = false;
  if (!existsSync(path.join(ROOT, 'data/travel-corpus.json'))) ok = false;

  let ollamaModels = [];
  try {
    const tags = await fetchJson(`${config.ollamaHost}/models`, {}, 8000);
    ollamaModels = (tags.data ?? []).map((m) => m.id);
  } catch (error) {
    checks.push(['llama-server-api', `error: ${error.message}`]);
    ok = false;
  }

  for (const [name, value] of checks) {
    console.log(`${name}: ${value}`);
  }
  if (config.openclawMinVersion && openclawVersion !== 'missing' && !openclawVersion.startsWith('error:')) {
    const installed = extractVersion(openclawVersion);
    const versionOk = installed ? compareVersions(installed, config.openclawMinVersion) >= 0 : false;
    console.log(`openclaw min version: ${config.openclawMinVersion}`);
    console.log(`openclaw version ok: ${versionOk ? 'yes' : 'no'}`);
    if (!versionOk) ok = false;
  }
  console.log(`configured model: ${config.model}`);
  const modelInstalled = ollamaModels.includes(config.model);
  console.log(`model installed: ${modelInstalled ? 'yes' : 'no'}`);
  if (!modelInstalled) ok = false;
  if (!ok) process.exitCode = 1;
}

async function runDemo(config, args) {
  const model = args.model ?? config.model;
  const effectiveConfig = { ...config, model };
  const profile = buildTripProfile(config, args);
  const corpusResponse = loadTravelCorpus();
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'runs', `${timestamp()}-${slugify(profile.partnerName)}-surprise-trip`));
  await fs.mkdir(outDir, { recursive: true });

  console.log(`Brief: ${profile.brief}`);
  console.log(`Origin: ${profile.origin}`);
  console.log(`Budget: $${profile.budget}`);
  console.log(`Output: ${outDir}`);

  let corpus = JSON.parse(corpusResponse);
  if (!args['skip-model']) {
    try {
      const generated = await searchDestinationsForBrief(effectiveConfig, profile);
      if (generated.length) {
        corpus = { ...corpus, origin: profile.origin, generatedFor: profile.brief, destinations: generated };
        console.log(`Destinations from model: ${generated.map((d) => d.name).join(', ')}`);
      }
    } catch (error) {
      console.log(`Falling back to static corpus (${error.message.slice(0, 120)})`);
    }
  }
  const [destinationResearch, trailResearch, logisticsResearch] = await Promise.all([
    Promise.resolve(researchDestinations(profile, corpus.destinations)),
    Promise.resolve(researchTrails(profile, corpus.destinations)),
    Promise.resolve(researchLogistics(profile, corpus.destinations)),
  ]);

  let packages = mergePackages(profile, destinationResearch, trailResearch, logisticsResearch, corpus.destinations).slice(0, 3);
  packages = attachRevealMessages(profile, packages);
  if (!args['skip-model']) {
    packages = await polishRevealMessagesWithFallback(effectiveConfig, profile, packages);
  }
  const plannerSummary = args['skip-model']
    ? deterministicSummary(profile, packages)
    : await summarizeWithFallback(effectiveConfig, profile, packages);

  const analysis = {
    profile,
    generatedAt: new Date().toISOString(),
    source: 'mock-travel-search',
    packages,
    rejected: destinationResearch.rejected,
  };

  await fs.writeFile(path.join(outDir, 'brief.txt'), `${profile.brief}\n`);
  await fs.writeFile(path.join(outDir, 'mock-travel-search.json'), `${corpusResponse.trim()}\n`);
  await writeJson(path.join(outDir, 'analysis.json'), analysis);
  await fs.writeFile(path.join(outDir, 'trip-packages.md'), renderTripPackages(profile, packages, plannerSummary));
  await fs.writeFile(path.join(outDir, 'reveal-messages.md'), renderRevealMessages(packages));
  await fs.writeFile(path.join(outDir, 'booking-links.md'), renderBookingLinks(packages));
  await fs.writeFile(path.join(outDir, 'index.html'), renderHtml(profile, packages, plannerSummary));

  console.log(`Packages: ${packages.length}`);
  console.log(`Top pick: ${packages[0]?.name ?? 'none'}`);
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
}

function loadTravelCorpus() {
  const toolPath = path.join(ROOT, 'tools/mock-travel-search');
  if (existsSync(toolPath)) {
    return run(toolPath, ['search'], { timeout: 30000 });
  }
  return requireJsonFallback(path.join(ROOT, 'data/travel-corpus.json'));
}

function requireJsonFallback(filePath) {
  return spawnSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(filePath)}, 'utf8'))`], { encoding: 'utf8' }).stdout;
}

function buildTripProfile(config, args) {
  const sample = config.sample ?? {};
  const brief = args.brief ?? sample.brief ?? 'Plan a surprise weekend trip for my partner. She loves hiking, hates crowds, and we have $1,200.';
  const budget = Number(String(args.budget ?? extractBudget(brief) ?? sample.budget ?? 1200).replace(/[^0-9.]/g, ''));
  const origin = args.origin ?? sample.origin ?? 'San Francisco, CA';
  const partnerName = args['partner-name'] ?? sample.partnerName ?? 'your partner';
  const travelerName = args['traveler-name'] ?? sample.travelerName ?? 'you';
  const dates = args.dates ?? sample.dates ?? inferDates(brief);
  const lower = brief.toLowerCase();
  const hatesCrowds = /hate|hates|avoid|quiet|crowd/.test(lower);
  const lovesHiking = /hiking|hike|trail|outdoor|outside/.test(lower);
  const surprise = /surprise/.test(lower);
  return {
    brief,
    origin,
    budget,
    partnerName,
    travelerName,
    dates,
    hatesCrowds,
    lovesHiking,
    surprise,
    priorities: [
      lovesHiking ? 'hiking-forward' : 'activity-forward',
      hatesCrowds ? 'low-crowd' : 'easy logistics',
      'within-budget',
      surprise ? 'reveal-worthy' : 'decision-ready',
    ],
  };
}

function extractBudget(text) {
  const match = String(text).match(/\$?\s*([0-9][0-9,]{2,})(?:\s*dollars)?/i);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

function inferDates(text) {
  const lower = String(text).toLowerCase();
  if (lower.includes('spring')) return 'a spring weekend';
  if (lower.includes('fall') || lower.includes('autumn')) return 'a fall weekend';
  if (lower.includes('winter')) return 'a winter weekend';
  if (lower.includes('summer')) return 'an early summer weekend';
  return 'a weekend';
}

function researchDestinations(profile, destinations) {
  const evaluated = destinations.map((destination) => {
    const total = totalCost(destination.costs);
    const overBudget = Math.max(0, total - profile.budget);
    const seasonBonus = seasonMatches(profile.dates, destination.seasonFit) ? 8 : 0;
    const crowdPenalty = profile.hatesCrowds ? destination.crowdLevel * 5 : destination.crowdLevel * 2;
    const travelPenalty = destination.travelMode === 'fly' && profile.budget < 1000 ? 8 : 0;
    const score = destination.hikingFit * 4 +
      destination.romanceFit * 3 +
      seasonBonus -
      crowdPenalty -
      overBudget / 25 -
      travelPenalty;
    return {
      id: destination.id,
      score: Math.round(score * 10) / 10,
      total,
      underBudget: total <= profile.budget,
      fitReasons: [
        destination.whyFits,
        `Crowd level ${destination.crowdLevel}/10 with a quiet-window tactic: ${destination.quietWindow}.`,
        destination.travelMode === 'drive'
          ? `No airport needed; estimated drive is ${destination.driveHours} hours.`
          : `Flight weekend; estimated flight time is ${destination.flightHours} hours.`,
      ],
      risks: destination.risks,
    };
  }).sort((a, b) => b.score - a.score);

  return {
    selected: evaluated.filter((item) => item.underBudget).slice(0, 4),
    rejected: evaluated.filter((item) => !item.underBudget).map((item) => ({
      id: item.id,
      reason: `Estimated $${item.total} exceeds $${profile.budget} budget.`,
    })),
  };
}

function researchTrails(profile, destinations) {
  const byDestination = {};
  for (const destination of destinations) {
    const trails = destination.trails
      .map((trail) => ({
        ...trail,
        fitNote: trail.difficulty === 'hard'
          ? 'Use this only if she wants a stronger hike; pair it with a slow recovery afternoon.'
          : 'Fits the quiet hiking brief without making the whole weekend feel like training.',
      }))
      .sort((a, b) => trailRank(a) - trailRank(b));
    byDestination[destination.id] = trails.slice(0, 2);
  }
  return byDestination;
}

function researchLogistics(profile, destinations) {
  const byDestination = {};
  for (const destination of destinations) {
    const total = totalCost(destination.costs);
    byDestination[destination.id] = {
      costs: destination.costs,
      total,
      budgetRemaining: profile.budget - total,
      lodging: destination.lodging,
      transportLinks: destination.transportLinks,
      bookingLinks: destination.bookingLinks,
      logisticsNote: total <= profile.budget
        ? `Fits the $${profile.budget} budget with $${profile.budget - total} to spare.`
        : `Runs $${total - profile.budget} over the stated budget.`,
    };
  }
  return byDestination;
}

function mergePackages(profile, destinationResearch, trailResearch, logisticsResearch, destinations) {
  const allDestinations = destinations ?? readCorpusDestinations();
  return destinationResearch.selected.map((item, index) => {
    const destination = allDestinations.find((candidate) => candidate.id === item.id);
    const logistics = logisticsResearch[item.id];
    const trails = trailResearch[item.id] ?? [];
    return {
      rank: index + 1,
      id: item.id,
      name: destination.name,
      region: destination.region,
      travelMode: destination.travelMode,
      score: item.score,
      totalCost: logistics.total,
      budgetRemaining: logistics.budgetRemaining,
      costs: logistics.costs,
      lodging: logistics.lodging,
      transportLinks: logistics.transportLinks,
      bookingLinks: logistics.bookingLinks,
      trails,
      whySheWillLoveThis: buildRationale(profile, destination, trails),
      fitReasons: item.fitReasons,
      risks: item.risks,
      logisticsNote: logistics.logisticsNote,
      quietWindow: destination.quietWindow,
    };
  }).sort((a, b) => {
    const byBudget = Number(b.budgetRemaining >= 0) - Number(a.budgetRemaining >= 0);
    return byBudget || b.score - a.score;
  }).map((pkg, index) => ({ ...pkg, rank: index + 1 }));
}

function readCorpusDestinations() {
  const raw = spawnSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(path.join(ROOT, 'data/travel-corpus.json'))}, 'utf8'))`], { encoding: 'utf8' }).stdout;
  return JSON.parse(raw).destinations;
}

function buildRationale(profile, destination, trails) {
  const trail = trails[0];
  const quiet = profile.hatesCrowds
    ? `The plan is built around ${destination.quietWindow}, so it avoids the exact crowded-weekend feeling she hates.`
    : 'The plan keeps logistics easy without overpacking the weekend.';
  return `${destination.name} works because it gives her real hiking, not filler. ${trail?.name ?? 'The main hike'} adds the outdoor payoff, while ${destination.lodging.neighborhood} keeps the weekend calm. ${quiet}`;
}

function attachRevealMessages(profile, packages) {
  return packages.map((pkg) => ({
    ...pkg,
    revealMessage: deterministicReveal(profile, pkg),
  }));
}

function deterministicReveal(profile, pkg) {
  const firstName = profile.partnerName === 'your partner' ? '' : ` ${profile.partnerName}`;
  const trail = pkg.trails[0];
  const transport = pkg.travelMode === 'drive' ? 'a simple drive instead of airport chaos' : 'a quick flight and a real change of scenery';
  const detail = revealDetail(pkg);
  return [
    `Hey${firstName}, I planned a quiet weekend for us in ${pkg.name}.`,
    `I picked it because it gives us ${detail}, ${transport}, and an early ${trail.name} hike before the crowds show up.`,
    `I know you love being outside, and I wanted this to feel like a real reset instead of another overplanned weekend.`,
    `If you are in, I will handle the booking. You just need hiking shoes and one relaxed dinner outfit.`,
  ].join(' ');
}

function revealDetail(pkg) {
  if (pkg.id.includes('mendocino')) return 'redwoods, ocean air, and a little inn time';
  if (pkg.id.includes('lassen')) return 'waterfalls, volcanic scenery, and quiet trail mornings';
  if (pkg.id.includes('tucson')) return 'desert sunrise, saguaros, and warm evening air';
  if (pkg.id.includes('bend')) return 'Cascade views, pine forest, and a slower stay outside the busy downtown';
  if (pkg.id.includes('ojai')) return 'golden-hour foothills, good food, and a calm place to land';
  return 'the kind of trail time that feels chosen for you';
}

async function polishRevealMessagesWithFallback(config, profile, packages) {
  try {
    const prompt = await fs.readFile(path.join(ROOT, config.claws.reveal), 'utf8');
    const payload = packages.map((pkg) => ({
      id: pkg.id,
      destination: pkg.name,
      partnerName: profile.partnerName,
      brief: profile.brief,
      rationale: pkg.whySheWillLoveThis,
      draft: pkg.revealMessage,
    }));
    const response = await callOllama(config, [
      { role: 'system', content: `${prompt}\nReturn JSON only: {"messages":[{"id":"...","message":"..."}]}. Keep each message under 110 words.` },
      { role: 'user', content: `/no_think\n${JSON.stringify(payload)}` },
    ]);
    const parsed = extractJson(response);
    if (!Array.isArray(parsed.messages)) return packages;
    const byId = new Map(parsed.messages.map((item) => [item.id, item.message]));
    return packages.map((pkg) => ({
      ...pkg,
      revealMessage: typeof byId.get(pkg.id) === 'string' && byId.get(pkg.id).trim()
        ? byId.get(pkg.id).trim()
        : pkg.revealMessage,
    }));
  } catch {
    return packages;
  }
}

async function summarizeWithFallback(config, profile, packages) {
  try {
    const prompt = await fs.readFile(path.join(ROOT, config.claws.destinations), 'utf8');
    const response = await callOllama(config, [
      { role: 'system', content: `${prompt}\nWrite a concise decision note in Markdown. Do not invent prices, links, or destinations.` },
      { role: 'user', content: `/no_think\n${JSON.stringify({ profile, packages })}` },
    ]);
    return response.trim() || deterministicSummary(profile, packages);
  } catch (error) {
    return `${deterministicSummary(profile, packages)}\n\n_Model summary fallback used: ${error.message}_`;
  }
}

function deterministicSummary(profile, packages) {
  const top = packages[0];
  return `## Decision Note\n\nBest overall pick: ${top.name}. It stays within the $${profile.budget} budget, prioritizes hiking, and has the clearest low-crowd plan.\n\nThe safest booking path is to hold lodging first, then confirm transport, then send the reveal message after both are refundable or cancellable.`;
}

async function callOllama(config, messages) {
  const response = await fetchJson(`${config.ollamaHost}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
      temperature: config.temperature ?? 0.45,
      max_tokens: config.maxOutputTokens ?? 2048,
    }),
  }, 180000);
  return response.choices?.[0]?.message?.content ?? '';
}

async function callOllamaJson(config, messages, options = {}) {
  const response = await fetchJson(`${config.ollamaHost}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 6000,
      response_format: { type: 'json_object' },
    }),
  }, options.timeout ?? 240000);
  const raw = response.choices?.[0]?.message?.content ?? '';
  try {
    return JSON.parse(raw);
  } catch {
    const extracted = extractJson(raw);
    if (extracted) {
      try { return JSON.parse(extracted); } catch {}
    }
    throw new Error(`Model returned non-JSON: ${raw.slice(0, 400)}`);
  }
}

async function searchDestinationsForBrief(config, profile) {
  const system = `You generate plausible vacation destination candidates for a surprise trip planner. Return a JSON object with a "destinations" array containing 3 entries. Each destination must follow this exact schema:

{
  "id": "slug-like-string",
  "name": "Destination headline e.g. 'Taipei + Yangmingshan'",
  "region": "Region or country e.g. 'Taipei, Taiwan'",
  "travelMode": "drive" or "fly",
  "driveHours": number or null,
  "flightHours": number or null,
  "crowdLevel": integer 1-10 (lower is quieter),
  "hikingFit": integer 1-10 (higher means better for hiking),
  "romanceFit": integer 1-10,
  "seasonFit": ["spring","summer","fall","winter", or season phrases],
  "quietWindow": "Short string describing the best low-crowd window",
  "whyFits": "One or two sentence pitch tied to the user's brief",
  "risks": ["short string", ...],
  "costs": { "transport": int, "lodging": int, "food": int, "activities": int, "contingency": int },
  "lodging": { "name": "string", "neighborhood": "string", "notes": "string", "bookingUrl": "https URL" },
  "transportLinks": [{ "label": "string", "url": "https URL" }],
  "bookingLinks": [{ "label": "string", "url": "https URL" }],
  "trails": [{ "name": "string", "difficulty": "easy|moderate|hard", "distanceMiles": number, "elevationFeet": number, "bestTime": "string", "crowdTip": "string", "reviewSignal": "string", "url": "https URL" }]
}

Rules:
- If the brief names a specific destination (city, country, park), the FIRST entry MUST be that destination. Add 2 alternatives that fit the same vibe.
- If the brief is open-ended, propose 3 destinations that suit the partner profile.
- Total costs (sum of all five cost fields) should fit within the budget.
- Use real, googlable place names and plausible URLs.
- Output strict JSON only — no markdown, no commentary.`;
  const userMessage = `Brief: ${profile.brief}
Origin: ${profile.origin}
Budget: $${profile.budget}
Partner profile: hatesCrowds=${profile.hatesCrowds}, lovesHiking=${profile.lovesHiking}, dates=${profile.dates}

Generate 3 destinations now.`;
  const out = await callOllamaJson(config, [
    { role: 'system', content: system },
    { role: 'user', content: userMessage },
  ], { maxTokens: 6500 });
  const destinations = Array.isArray(out?.destinations) ? out.destinations : Array.isArray(out) ? out : [];
  return destinations.filter((d) => d && typeof d.name === 'string').slice(0, 5);
}

async function fetchJson(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  const raw = String(text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found');
    return JSON.parse(match[0]);
  }
}

function totalCost(costs) {
  return Object.values(costs).reduce((sum, value) => sum + Number(value || 0), 0);
}

function seasonMatches(dates, seasonFit) {
  const lower = String(dates).toLowerCase();
  return seasonFit.some((season) => lower.includes(String(season).split(/\s+/).pop()));
}

function trailRank(trail) {
  const difficulty = { moderate: 1, hard: 2, easy: 3 }[String(trail.difficulty).toLowerCase()] ?? 2;
  return difficulty + trail.distanceMiles / 20;
}

function renderTripPackages(profile, packages, summary) {
  return `# Surprise Trip Packages\n\nBrief: ${profile.brief}\n\nOrigin: ${profile.origin}\n\nBudget: $${profile.budget}\n\n${summary}\n\n${packages.map(renderPackageMarkdown).join('\n\n---\n\n')}\n`;
}

function renderPackageMarkdown(pkg) {
  return `## Option ${pkg.rank}: ${pkg.name}\n\nRegion: ${pkg.region}\n\nEstimated total: $${pkg.totalCost} (${pkg.budgetRemaining >= 0 ? `$${pkg.budgetRemaining} under budget` : `$${Math.abs(pkg.budgetRemaining)} over budget`})\n\n### Why She Will Love This\n\n${pkg.whySheWillLoveThis}\n\n### Logistics\n\n- Travel mode: ${pkg.travelMode}\n- Lodging: ${pkg.lodging.name}, ${pkg.lodging.neighborhood}\n- Crowd plan: ${pkg.quietWindow}\n- Budget note: ${pkg.logisticsNote}\n\n### Cost Breakdown\n\n${costList(pkg.costs)}\n\n### Hikes\n\n${pkg.trails.map((trail) => `- ${trail.name}: ${trail.difficulty}, ${trail.distanceMiles} mi, ${trail.elevationFeet} ft gain. Best time: ${trail.bestTime}. Crowd tactic: ${trail.crowdTip}`).join('\n')}\n\n### Reveal Message\n\n${pkg.revealMessage}\n\n### Booking Links\n\n${linkList([...pkg.transportLinks, ...pkg.bookingLinks, ...pkg.trails.map((trail) => ({ label: trail.name, url: trail.url }))])}`;
}

function renderRevealMessages(packages) {
  return `# Ready-To-Send Reveal Messages\n\n${packages.map((pkg) => `## ${pkg.name}\n\n${pkg.revealMessage}`).join('\n\n---\n\n')}\n`;
}

function renderBookingLinks(packages) {
  return `# Booking Links\n\n${packages.map((pkg) => `## ${pkg.name}\n\n${linkList([...pkg.transportLinks, ...pkg.bookingLinks, ...pkg.trails.map((trail) => ({ label: trail.name, url: trail.url }))])}`).join('\n\n')}\n`;
}

function costList(costs) {
  return Object.entries(costs)
    .map(([key, value]) => `- ${titleCase(key)}: $${value}`)
    .join('\n');
}

function linkList(links) {
  return links.map((link) => `- [${link.label}](${link.url})`).join('\n');
}

function renderHtml(profile, packages, summary) {
  const cards = packages.map((pkg) => `<section class="package">
<div class="rank">Option ${pkg.rank}</div>
<h2>${escapeHtml(pkg.name)}</h2>
<p class="muted">${escapeHtml(pkg.region)} &middot; ${escapeHtml(pkg.travelMode)} &middot; $${pkg.totalCost}</p>
<p><strong>Why she will love this:</strong> ${escapeHtml(pkg.whySheWillLoveThis)}</p>
<div class="grid">
  <div><h3>Cost</h3><ul>${Object.entries(pkg.costs).map(([key, value]) => `<li>${escapeHtml(titleCase(key))}: $${value}</li>`).join('')}</ul></div>
  <div><h3>Hikes</h3><ul>${pkg.trails.map((trail) => `<li><strong>${escapeHtml(trail.name)}</strong>: ${escapeHtml(trail.difficulty)}, ${trail.distanceMiles} mi<br><span>${escapeHtml(trail.crowdTip)}</span></li>`).join('')}</ul></div>
</div>
<h3>Reveal Message</h3>
<blockquote>${escapeHtml(pkg.revealMessage)}</blockquote>
<h3>Booking Links</h3>
<ul>${[...pkg.transportLinks, ...pkg.bookingLinks, ...pkg.trails.map((trail) => ({ label: trail.name, url: trail.url }))].map((link) => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></li>`).join('')}</ul>
</section>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Surprise Trip Planner</title>
<style>
:root{--ink:#162024;--muted:#667085;--line:#d8dee8;--bg:#f6f7f9;--panel:#fff;--green:#0f766e;--warm:#9a3412}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1120px;margin:0 auto;padding:34px 20px 56px}h1{font-size:34px;line-height:1.1;margin:0 0 8px}h2{font-size:24px;margin:0 0 4px}h3{font-size:15px;margin:18px 0 8px;text-transform:uppercase;color:var(--muted)}
.brief,.package{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;margin:0 0 18px}.muted{color:var(--muted)}.rank{color:var(--green);font-weight:700}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}li{margin:0 0 7px}span{color:var(--muted)}blockquote{border-left:4px solid var(--warm);margin:0;padding:10px 16px;background:#fff7ed;border-radius:0 8px 8px 0;font-size:17px}a{color:#0f766e}
@media(max-width:760px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body><main>
<h1>Surprise Trip Planner</h1>
<section class="brief"><p><strong>Brief:</strong> ${escapeHtml(profile.brief)}</p><p class="muted">Origin: ${escapeHtml(profile.origin)} &middot; Budget: $${profile.budget} &middot; Dates: ${escapeHtml(profile.dates)}</p>${markdownToHtml(summary)}</section>
${cards}
</main></body></html>`;
}

function markdownToHtml(markdown) {
  return escapeHtml(markdown)
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

function extractVersion(text) {
  return String(text).match(/\d+\.\d+\.\d+/)?.[0] ?? '';
}

function compareVersions(left, right) {
  const parse = (value) => String(value).split('.').map((part) => Number(part));
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function titleCase(text) {
  return String(text)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'trip';
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? (args.help ? 'help' : null);
  const config = await readConfig();

  if (!command || command === 'help') {
    console.log(usage());
    return;
  }
  if (command === 'doctor') {
    await doctor(config);
    return;
  }
  if (command === 'run') {
    await runDemo(config, args);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
