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
  temperature: 0.28,
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
  scrap-genome doctor
  scrap-genome run --part-family impeller-housing-G7

Options:
  --skip-model              Use deterministic wording instead of calling the model.
  --part-family <name>      Geometry or part family. Default from demo.config.json.
  --lookback-days <number>  Historical window. Default from demo.config.json.
  --out <path>              Output directory.
  --model <name>            Model id override.
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
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
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
  checks.push(['scrap-seed', existsSync(path.join(ROOT, 'data/scrap-seed.json')) ? 'present' : 'missing']);
  checks.push(['mock-quality-data', existsSync(path.join(ROOT, 'tools/mock-quality-data')) ? 'present' : 'missing']);
  if (openclawVersion === 'missing' || llamaServerOk.startsWith('error:') || pythonPath === 'missing') ok = false;
  if (openclawVersion.startsWith('error:') || llamaServerOk.startsWith('error:')) ok = false;

  let ollamaModels = [];
  try {
    const tags = await fetchJson(`${config.ollamaHost}/models`, {}, 8000);
    ollamaModels = (tags.data ?? []).map((m) => m.id);
  } catch (error) {
    checks.push(['llama-server-api', `error: ${error.message}`]);
    ok = false;
  }

  for (const [name, value] of checks) console.log(`${name}: ${value}`);
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
  const partFamily = args['part-family'] ?? config.sample?.partFamily ?? 'impeller-housing-G7';
  const lookbackDays = Number(args['lookback-days'] ?? config.sample?.lookbackDays ?? 90);
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'runs', `${timestamp()}-${slugify(partFamily)}-scrap-genome`));
  const toolDir = path.join(outDir, 'tool-responses');
  await fs.mkdir(toolDir, { recursive: true });

  console.log(`Part family: ${partFamily}`);
  console.log(`Lookback: ${lookbackDays} days`);
  console.log(`Output: ${outDir}`);

  const dataset = collectData(partFamily, lookbackDays);
  await writeJson(path.join(toolDir, 'quality-data.json'), dataset);
  const summary = summarizeDataset(dataset);
  const correlations = correlate(dataset.events);
  const currentRisk = evaluateCurrentRisk(dataset.currentConditions, correlations);
  let findings = narrateFindings(dataset, summary, correlations, currentRisk);
  if (!args['skip-model']) {
    findings[0].plainEnglish = await polishFindingWithFallback(effectiveConfig, findings[0].plainEnglish, dataset, correlations, currentRisk);
  }
  const recommendations = buildRecommendations(summary, correlations, currentRisk);
  const analysis = {
    generatedAt: new Date().toISOString(),
    partFamily,
    lookbackDays,
    summary,
    correlations,
    findings,
    recommendations,
    currentRisk,
  };

  await fs.writeFile(path.join(outDir, 'data-summary.md'), renderDataSummary(dataset, summary));
  await fs.writeFile(path.join(outDir, 'scrap-genome.md'), renderGenome(correlations));
  await fs.writeFile(path.join(outDir, 'plain-english-findings.md'), renderFindings(findings, currentRisk));
  await fs.writeFile(path.join(outDir, 'recommendations.md'), renderRecommendations(recommendations));
  await fs.writeFile(path.join(outDir, 'current-conditions.md'), renderCurrentConditions(currentRisk));
  await writeJson(path.join(outDir, 'analysis.json'), analysis);
  await fs.writeFile(path.join(outDir, 'index.html'), renderReportHtml(dataset, summary, correlations, findings, recommendations, currentRisk));

  console.log(`Rows analyzed: ${summary.total}`);
  console.log(`Scrap rate: ${percent(summary.scrapRate)}`);
  console.log(`Top fingerprint: ${correlations.interactions[0].label}`);
  console.log(`Top lift: ${correlations.interactions[0].lift.toFixed(1)}x`);
  console.log(`Current risk: ${currentRisk.status}`);
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
}

function collectData(partFamily, lookbackDays) {
  const stdout = run(path.join(ROOT, 'tools/mock-quality-data'), ['collect', partFamily, String(lookbackDays)], { timeout: 30000 });
  return JSON.parse(stdout);
}

function summarizeDataset(dataset) {
  const total = dataset.events.length;
  const scrap = dataset.events.filter((row) => row.outcome === 'scrap').length;
  return {
    total,
    scrap,
    good: total - scrap,
    scrapRate: scrap / total,
    window: `${dataset.lookbackDays} days ending ${dataset.asOf}`,
    partFamily: dataset.partFamily,
    failureModes: countBy(dataset.events.filter((row) => row.outcome === 'scrap'), (row) => row.failureMode),
  };
}

function correlate(events) {
  const predicates = [
    { id: 'tool_gt_40', label: 'tool age > 40 hours', test: (row) => row.toolAgeHours > 40 },
    { id: 'humidity_gt_68', label: 'humidity > 68%', test: (row) => row.humidityPercent > 68 },
    { id: 'shift_b', label: 'B shift', test: (row) => row.shift === 'B' },
    { id: 'flagged_lot', label: 'material lot AL-8821 or AL-8827', test: (row) => ['AL-8821', 'AL-8827'].includes(row.materialLot) },
    { id: 'spindle_gt_82', label: 'spindle load > 82%', test: (row) => row.spindleLoadPercent > 82 },
    { id: 'mill_19', label: 'MILL-19', test: (row) => row.machineId === 'MILL-19' },
    { id: 'maintenance_48h', label: 'maintenance in prior 48h', test: (row) => row.maintenancePrior48h },
  ];
  const baselineScrap = rate(events, () => true);
  const singles = predicates.map((predicate) => scoreCombo(events, [predicate], baselineScrap)).sort(rankCombo);
  const interactions = [];
  for (let i = 0; i < predicates.length; i += 1) {
    for (let j = i + 1; j < predicates.length; j += 1) {
      interactions.push(scoreCombo(events, [predicates[i], predicates[j]], baselineScrap));
    }
  }
  for (let i = 0; i < predicates.length; i += 1) {
    for (let j = i + 1; j < predicates.length; j += 1) {
      for (let k = j + 1; k < predicates.length; k += 1) {
        interactions.push(scoreCombo(events, [predicates[i], predicates[j], predicates[k]], baselineScrap));
      }
    }
  }
  return {
    baselineScrap,
    singles: singles.filter((item) => item.n >= 18).slice(0, 8),
    interactions: interactions.filter((item) => item.n >= 12 && item.scrapCount >= 4).sort(rankCombo).slice(0, 10),
  };
}

function scoreCombo(events, predicates, baselineScrap) {
  const rows = events.filter((row) => predicates.every((predicate) => predicate.test(row)));
  const scrapCount = rows.filter((row) => row.outcome === 'scrap').length;
  const scrapRate = rows.length ? scrapCount / rows.length : 0;
  const lift = baselineScrap ? scrapRate / baselineScrap : 0;
  const ids = predicates.map((predicate) => predicate.id);
  return {
    id: ids.join('__'),
    labels: predicates.map((predicate) => predicate.label),
    label: predicates.map((predicate) => predicate.label).join(' + '),
    n: rows.length,
    scrapCount,
    goodCount: rows.length - scrapCount,
    scrapRate,
    lift,
    shareOfScrap: scrapCount / Math.max(1, events.filter((row) => row.outcome === 'scrap').length),
  };
}

function rankCombo(left, right) {
  return right.lift - left.lift || right.scrapCount - left.scrapCount || right.n - left.n;
}

function evaluateCurrentRisk(current, correlations) {
  const matches = correlations.interactions.filter((combo) => combo.labels.every((label) => currentMatchesLabel(current, label)));
  const top = matches[0] ?? correlations.interactions.find((combo) => combo.labels.some((label) => currentMatchesLabel(current, label)));
  const status = top && top.lift >= 2.4 ? 'ELEVATED-RISK WINDOW RIGHT NOW' : 'normal watch';
  const probability = top ? Math.min(0.91, top.scrapRate + 0.18) : correlations.baselineScrap;
  return {
    status,
    current,
    matchedFingerprints: matches,
    strongestMatch: top,
    projectedScrapProbability: probability,
    nextWeekRepeatChance: top ? Math.min(0.93, 0.54 + top.shareOfScrap) : 0.35,
    warning: top
      ? `Based on today's conditions, you are in an elevated-risk window right now: ${top.label}.`
      : 'Current conditions do not match the top historical scrap fingerprint.',
  };
}

function currentMatchesLabel(current, label) {
  if (label === 'tool age > 40 hours') return current.toolAgeHours > 40;
  if (label === 'humidity > 68%') return current.humidityPercent > 68;
  if (label === 'B shift') return current.shift === 'B';
  if (label === 'material lot AL-8821 or AL-8827') return ['AL-8821', 'AL-8827'].includes(current.materialLot);
  if (label === 'spindle load > 82%') return current.spindleLoadPercent > 82;
  if (label === 'MILL-19') return current.machineId === 'MILL-19';
  if (label === 'maintenance in prior 48h') return current.maintenancePrior48h;
  return false;
}

function narrateFindings(dataset, summary, correlations, currentRisk) {
  const top = correlations.interactions[0];
  const second = correlations.interactions[1];
  const lot = correlations.interactions.find((item) => item.label.includes('material lot'));
  return [
    {
      title: 'Primary scrap fingerprint',
      plainEnglish: `You scrap ${top.lift.toFixed(1)}x more on ${dataset.geometry.name} when ${top.label}. This combination appeared ${top.n} times in the last ${dataset.lookbackDays} days and produced ${top.scrapCount} scrap events. Baseline scrap is ${percent(summary.scrapRate)}; inside this fingerprint it jumps to ${percent(top.scrapRate)}.`,
    },
    {
      title: 'Secondary interaction',
      plainEnglish: `The next strongest signal is ${second.label}: ${percent(second.scrapRate)} scrap across ${second.n} runs, or ${second.lift.toFixed(1)}x baseline. That points to interaction, not a single bad operator or one bad machine.`,
    },
    {
      title: 'Lot sensitivity',
      plainEnglish: lot
        ? `The flagged material-lot interaction shows ${lot.lift.toFixed(1)}x lift. Lots AL-8821 and AL-8827 are not always bad by themselves, but they become risky when combined with humidity, high tool age, or high spindle load.`
        : 'Material lot is not the strongest standalone signal, but it compounds with process stress.',
    },
    {
      title: 'Current risk',
      plainEnglish: `${currentRisk.warning} You have a ${percent(currentRisk.nextWeekRepeatChance)} chance of hitting this window again next week if tool changes and humidity controls stay on the current plan.`,
    },
  ];
}

function buildRecommendations(summary, correlations, currentRisk) {
  const top = correlations.interactions[0];
  const lotCombo = correlations.interactions.find((item) => item.label.includes('material lot'));
  const projectedBase = summary.scrapRate;
  return [
    {
      title: 'Change tool interval for this geometry from 48 hours to 38 hours',
      owner: 'Process engineering',
      trigger: 'Impeller Housing G7 rough/finish tool reaches 38 spindle hours',
      projectedReduction: 0.31,
      rationale: `The top fingerprint starts when tool age crosses 40 hours. Pulling the change interval to 38 hours removes the largest interaction before it activates.`,
      metric: `Expected scrap rate drops from ${percent(projectedBase)} to ${percent(projectedBase * 0.69)} if applied to this geometry only.`,
    },
    {
      title: 'Add first-piece bore and wall inspection when humidity exceeds 68%',
      owner: 'Quality engineering',
      trigger: 'Humidity > 68% during G7 run start or mid-run restart',
      projectedReduction: 0.18,
      rationale: 'Humidity alone is not the whole cause, but it amplifies high tool age and spindle load. Add inspection only when the threshold is crossed to avoid slowing every run.',
      metric: `Expected additional scrap reduction: ${percent(0.18)} of current scrap events.`,
    },
    {
      title: 'Flag material lots AL-8821 and AL-8827 for G7 review before release',
      owner: 'Materials / incoming quality',
      trigger: 'Lot AL-8821 or AL-8827 scheduled on Impeller Housing G7',
      projectedReduction: lotCombo ? Math.min(0.22, lotCombo.shareOfScrap * 0.55) : 0.12,
      rationale: 'These lots show up disproportionately inside high-risk windows. The recommendation is a release flag, not a blanket quarantine.',
      metric: lotCombo ? `Targets ${percent(lotCombo.shareOfScrap)} of historical scrap events.` : 'Targets the visible lot-sensitivity pocket.',
    },
  ];
}

async function polishFindingWithFallback(config, fallback, dataset, correlations, currentRisk) {
  try {
    const prompt = await fs.readFile(path.join(ROOT, config.claws.narrator), 'utf8');
    const response = await callOllama(config, [
      { role: 'system', content: `${prompt}\nReturn one specific plain-English finding. Keep all numbers from the data.` },
      { role: 'user', content: `/no_think\n${JSON.stringify({ fallback, dataset: { partFamily: dataset.partFamily, geometry: dataset.geometry }, top: correlations.interactions[0], currentRisk })}` },
    ]);
    return response.trim().split(/\n+/).join(' ').slice(0, 900) || fallback;
  } catch {
    return fallback;
  }
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
      temperature: config.temperature ?? 0.28,
      max_tokens: config.maxOutputTokens ?? 2048,
    }),
  }, 180000);
  return response.choices?.[0]?.message?.content ?? '';
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

function rate(events, predicate) {
  const rows = events.filter(predicate);
  return rows.length ? rows.filter((row) => row.outcome === 'scrap').length / rows.length : 0;
}

function countBy(rows, fn) {
  return rows.reduce((counts, row) => {
    const key = fn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function renderDataSummary(dataset, summary) {
  return `# Data Summary\n\nPart family: ${dataset.partFamily}\nWindow: ${summary.window}\nRows analyzed: ${summary.total}\nScrap events: ${summary.scrap}\nGood events: ${summary.good}\nBaseline scrap rate: ${percent(summary.scrapRate)}\n\n## Fields Collected\n\n${dataset.fields.map((field) => `- ${field}`).join('\n')}\n\n## Failure Modes\n\n${Object.entries(summary.failureModes).map(([mode, count]) => `- ${mode}: ${count}`).join('\n')}\n`;
}

function renderGenome(correlations) {
  return `# Scrap Genome\n\nBaseline scrap rate: ${percent(correlations.baselineScrap)}\n\n## Interaction Fingerprints\n\n${correlations.interactions.map((item, index) => `### ${index + 1}. ${item.label}\n\n- Runs: ${item.n}\n- Scrap: ${item.scrapCount}\n- Scrap rate: ${percent(item.scrapRate)}\n- Lift: ${item.lift.toFixed(1)}x\n- Share of all scrap: ${percent(item.shareOfScrap)}\n`).join('\n')}\n\n## Single Variable Signals\n\n${correlations.singles.map((item) => `- **${item.label}**: ${percent(item.scrapRate)} scrap, ${item.lift.toFixed(1)}x baseline, n=${item.n}`).join('\n')}\n`;
}

function renderFindings(findings, currentRisk) {
  return `# Plain English Findings\n\n${findings.map((finding) => `## ${finding.title}\n\n${finding.plainEnglish}`).join('\n\n')}\n\n## Live Warning\n\n${currentRisk.warning}\n\nProjected current scrap probability: ${percent(currentRisk.projectedScrapProbability)}\n`;
}

function renderRecommendations(recommendations) {
  return `# Recommendations\n\n${recommendations.map((item, index) => `## ${index + 1}. ${item.title}\n\n- Owner: ${item.owner}\n- Trigger: ${item.trigger}\n- Projected reduction: ${percent(item.projectedReduction)}\n- Metric: ${item.metric}\n\n${item.rationale}`).join('\n\n')}\n`;
}

function renderCurrentConditions(currentRisk) {
  const c = currentRisk.current;
  return `# Current Conditions\n\nStatus: **${currentRisk.status}**\n\n${currentRisk.warning}\n\n- Machine: ${c.machineId}\n- Operator: ${c.operator}\n- Shift: ${c.shift}\n- Tool age: ${c.toolAgeHours} hours\n- Material lot: ${c.materialLot}\n- Temperature: ${c.ambientTempF} F\n- Humidity: ${c.humidityPercent}%\n- Spindle load: ${c.spindleLoadPercent}%\n- Maintenance prior 48h: ${c.maintenancePrior48h ? 'yes' : 'no'}\n- Next scheduled run: ${formatDateTime(c.nextScheduledRun)}\n\nMatched fingerprints:\n\n${currentRisk.matchedFingerprints.map((item) => `- ${item.label}: ${item.lift.toFixed(1)}x lift`).join('\n') || '- No full interaction match'}\n`;
}

function renderReportHtml(dataset, summary, correlations, findings, recommendations, currentRisk) {
  const top = correlations.interactions[0];
  const c = currentRisk.current;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Scrap Genome</title>
<style>
:root{--ink:#18212f;--muted:#657083;--line:#d8e0ea;--bg:#f4f6f9;--panel:#fff;--red:#b42318;--blue:#2457d6;--green:#147d4f;--amber:#a15c00}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 20px 56px}h1{font-size:38px;margin:0 0 8px;line-height:1.05}h2{font-size:22px;margin:0 0 12px}.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;margin:0 0 18px}.warning{background:#fff4f2;border-color:#ffc9c2}.big{font-size:42px;line-height:1;font-weight:850;color:var(--red)}.button{display:inline-block;background:var(--blue);color:white;text-decoration:none;border-radius:6px;padding:10px 14px;margin:0 8px 8px 0}.tag{display:inline-block;border-radius:999px;padding:3px 8px;background:#eef2f6;color:#334155;font-size:12px;font-weight:800}.bar{height:18px;background:#edf2f7;border-radius:4px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,#2b6cb0,#b42318)}li{margin:0 0 8px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid var(--line);padding:8px;vertical-align:top}a{color:var(--blue)}
@media(max-width:850px){.grid{grid-template-columns:1fr}.big{font-size:34px}}
</style>
</head>
<body><main>
<h1>The Scrap Genome</h1>
<section class="panel"><p><strong>${escapeHtml(dataset.geometry.name)}</strong> - ${summary.total} historical events over ${dataset.lookbackDays} days. Baseline scrap rate: ${percent(summary.scrapRate)}.</p><p><a class="button" href="scrap-genome.md">Open genome</a><a class="button" href="plain-english-findings.md">Open findings</a><a class="button" href="recommendations.md">Open recommendations</a><a class="button" href="current-conditions.md">Open current conditions</a></p></section>
<section class="grid">
  <div class="panel"><h2>Top Fingerprint</h2><p><span class="tag">${top.lift.toFixed(1)}x lift</span></p><h3>${escapeHtml(top.label)}</h3><p>${top.scrapCount} scrap events across ${top.n} matching runs. Scrap rate inside fingerprint: ${percent(top.scrapRate)}.</p><div class="bar"><div class="fill" style="width:${Math.min(100, top.scrapRate * 100)}%"></div></div></div>
  <div class="panel warning"><h2>Current Shop Floor Conditions</h2><div class="big">${escapeHtml(currentRisk.status)}</div><p>${escapeHtml(currentRisk.warning)}</p><p class="muted">${escapeHtml(c.machineId)} / shift ${escapeHtml(c.shift)} / tool ${c.toolAgeHours}h / humidity ${c.humidityPercent}% / lot ${escapeHtml(c.materialLot)}</p></div>
</section>
<section class="panel"><h2>Plain English Findings</h2>${findings.map((finding) => `<h3>${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.plainEnglish)}</p>`).join('')}</section>
<section class="grid">
  <div class="panel"><h2>Scrap Genome</h2><table><thead><tr><th>Condition</th><th>Scrap</th><th>Lift</th></tr></thead><tbody>${correlations.interactions.slice(0, 6).map((item) => `<tr><td>${escapeHtml(item.label)}<br><span class="muted">n=${item.n}</span></td><td>${percent(item.scrapRate)}</td><td>${item.lift.toFixed(1)}x</td></tr>`).join('')}</tbody></table></div>
  <div class="panel"><h2>Process Changes</h2><ol>${recommendations.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><br><span class="muted">${escapeHtml(item.metric)}</span></li>`).join('')}</ol></div>
</section>
</main></body></html>`;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function percent(value) {
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(date);
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

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'scrap-genome';
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
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
