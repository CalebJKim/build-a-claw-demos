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
  temperature: 0.5,
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
  side-project-launcher doctor
  side-project-launcher run --idea "I want to sell handmade soaps online..."

Options:
  --skip-model              Use deterministic copy instead of calling Ollama.
  --model <name>            Model id override. Default from demo.config.json.
  --founder-name <name>     Founder name for About copy.
  --audience <text>         Target buyer description.
  --location <place>        Market/location context.
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
  checks.push(['market-corpus', existsSync(path.join(ROOT, 'data/market-corpus.json')) ? 'present' : 'missing']);
  checks.push(['mock-market-search', existsSync(path.join(ROOT, 'tools/mock-market-search')) ? 'present' : 'missing']);
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
  const profile = buildIdeaProfile(config, args);
  const marketResponse = loadMarketCorpus();
  const corpus = JSON.parse(marketResponse);
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'runs', `${timestamp()}-${slugify(profile.category)}-launcher`));
  const landingDir = path.join(outDir, 'landing-page');
  await fs.mkdir(path.join(landingDir, 'assets'), { recursive: true });

  console.log(`Idea: ${profile.idea}`);
  console.log(`Category: ${profile.category}`);
  console.log(`Output: ${outDir}`);

  const [market, brand, copySeed] = await Promise.all([
    Promise.resolve(researchMarket(profile, corpus)),
    Promise.resolve(generateBrand(profile, corpus)),
    Promise.resolve(generateCopy(profile, corpus)),
  ]);

  let launchCopy = { ...copySeed, brandName: brand.winner.name, tagline: brand.tagline };
  if (!args['skip-model']) {
    launchCopy = await polishCopyWithFallback(effectiveConfig, profile, market, brand, launchCopy);
  }
  const checklist = buildWeekOneChecklist(profile, corpus, brand, market);
  const analysis = {
    profile,
    generatedAt: new Date().toISOString(),
    source: 'mock-market-search',
    market,
    brand,
    copy: launchCopy,
    checklist,
    landingPage: 'landing-page/index.html',
  };

  await fs.writeFile(path.join(outDir, 'idea.txt'), `${profile.idea}\n`);
  await fs.writeFile(path.join(outDir, 'mock-market-search.json'), `${marketResponse.trim()}\n`);
  await writeJson(path.join(outDir, 'analysis.json'), analysis);
  await fs.writeFile(path.join(outDir, 'market-research.md'), renderMarketResearch(market));
  await fs.writeFile(path.join(outDir, 'brand.md'), renderBrand(brand));
  await fs.writeFile(path.join(outDir, 'product-copy.md'), renderProductCopy(launchCopy));
  await fs.writeFile(path.join(outDir, 'week-one-checklist.md'), renderChecklist(checklist));
  await fs.writeFile(path.join(outDir, 'index.html'), renderReportHtml(profile, market, brand, launchCopy, checklist));
  await fs.writeFile(path.join(landingDir, 'index.html'), renderLandingPage(profile, brand, launchCopy));
  await fs.writeFile(path.join(landingDir, 'assets', 'soap-bars.svg'), renderSoapSvg(brand));

  console.log(`Brand: ${brand.winner.name}`);
  console.log(`Products: ${launchCopy.products.length}`);
  console.log(`Landing page: ${path.join(landingDir, 'index.html')}`);
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
}

function buildIdeaProfile(config, args) {
  const sample = config.sample ?? {};
  const idea = args.idea ?? sample.idea ?? 'I want to sell handmade soaps online. I have no idea where to start.';
  const lower = idea.toLowerCase();
  const category = lower.includes('soap') ? 'handmade soaps' : inferCategory(idea);
  return {
    idea,
    category,
    founderName: args['founder-name'] ?? sample.founderName ?? 'Avery',
    audience: args.audience ?? sample.audience ?? 'people who want something useful, giftable, and easy to understand',
    location: args.location ?? sample.location ?? 'United States',
    constraints: {
      beginner: /no idea|where to start|beginner|new/.test(lower),
      online: /online|etsy|shop|website|internet/.test(lower),
      handmade: /handmade|make|craft|soap/.test(lower),
    },
  };
}

function inferCategory(idea) {
  return String(idea)
    .replace(/^i\s+want\s+to\s+/i, '')
    .replace(/^sell\s+/i, '')
    .replace(/\s+online.*$/i, '')
    .replace(/[.?!]/g, '')
    .trim() || 'side project';
}

function loadMarketCorpus() {
  const toolPath = path.join(ROOT, 'tools/mock-market-search');
  if (existsSync(toolPath)) {
    return run(toolPath, ['search'], { timeout: 30000 });
  }
  return spawnSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(path.join(ROOT, 'data/market-corpus.json'))}, 'utf8'))`], { encoding: 'utf8' }).stdout;
}

function researchMarket(profile, corpus) {
  return {
    category: profile.category,
    summary: `${profile.category} can work as a small online launch if the offer is narrow: three bars, a giftable starter trio, and clear sink-side visuals.`,
    competitors: corpus.competitors,
    pricePoints: corpus.marketSignals.map((signal) => ({
      channel: signal.channel,
      range: signal.priceRange,
      signal: signal.signal,
    })),
    buyerLanguage: [...new Set(corpus.marketSignals.flatMap((signal) => signal.buyerLanguage))],
    gaps: corpus.gaps,
    launchChannels: corpus.channels,
  };
}

function generateBrand(profile, corpus) {
  const options = [
    {
      name: 'Basin & Bloom',
      rationale: 'Feels clean, botanical, and bathroom-native without sounding too precious.',
      score: 94,
    },
    {
      name: 'Quiet Lather',
      rationale: 'Directly owns the calm, low-overwhelm angle and works well for gentle everyday soap.',
      score: 91,
    },
    {
      name: 'Fern & Foam',
      rationale: 'Memorable and visual, but slightly more whimsical than the best positioning.',
      score: 86,
    },
  ];
  const winner = options.sort((a, b) => b.score - a.score)[0];
  return {
    options,
    winner,
    tagline: 'Small-batch soap for calmer sinks, showers, and gifts.',
    positioning: 'Giftable but practical botanical soap for people who want fewer, better choices.',
    visualDirection: {
      colors: ['sage', 'warm cream', 'clay', 'charcoal'],
      style: 'clean sink-side product photography, batch notes, botanical ingredients, simple labels',
    },
    corpusGapsUsed: corpus.gaps.slice(0, 3),
  };
}

function generateCopy(profile, corpus) {
  const products = corpus.launchProducts.map((product) => ({
    ...product,
    description: productCopy(product),
  }));
  return {
    brandName: 'Basin & Bloom',
    tagline: 'Small-batch soap for calmer sinks, showers, and gifts.',
    headline: 'Handmade soap that looks giftable and works every day.',
    subheadline: 'Three small-batch bars made for clean scents, creamy lather, and a calmer sink-side routine.',
    emailCta: 'Get the first batch note',
    emailPlaceholder: 'you@example.com',
    benefits: [
      'Three-bar launch collection, not an overwhelming scent wall.',
      'Gift-ready labels and everyday-use formulas.',
      'Small-batch process notes so buyers can see what they are getting.',
    ],
    products,
    about: `${profile.founderName} started this as a simple idea: soap should be pretty enough to give away and practical enough to use down to the last sliver. Basin & Bloom keeps the first collection tight, sensory, and useful: one gentle bar, one bright sink bar, and one crisp shower bar.`,
  };
}

function productCopy(product) {
  const copy = {
    'Lavender Oat Bar': 'A soft, creamy bar for the person who wants a calm scent and a gentle-feeling wash. Built around oat milk, lavender, and a lather that belongs by the sink.',
    'Citrus Clay Bar': 'A bright morning bar with orange peel and kaolin clay. Fresh without smelling like cleaner, and pretty enough to leave out for guests.',
    'Cedar Mint Bar': 'A cooler shower bar with cedar, mint, and charcoal. Made for the quick reset after a long day or a slow weekend morning.',
  };
  return copy[product.name] ?? product.notes;
}

async function polishCopyWithFallback(config, profile, market, brand, launchCopy) {
  try {
    const prompt = await fs.readFile(path.join(ROOT, config.claws.copy), 'utf8');
    const response = await callOllama(config, [
      { role: 'system', content: `${prompt}\nReturn JSON only with keys headline, subheadline, about, products, benefits, emailCta. Do not invent ingredients outside the provided products.` },
      { role: 'user', content: `/no_think\n${JSON.stringify({ profile, market, brand, launchCopy })}` },
    ]);
    const parsed = extractJson(response);
    return {
      ...launchCopy,
      headline: stringOr(parsed.headline, launchCopy.headline),
      subheadline: stringOr(parsed.subheadline, launchCopy.subheadline),
      about: stringOr(parsed.about, launchCopy.about),
      emailCta: stringOr(parsed.emailCta, launchCopy.emailCta),
      benefits: Array.isArray(parsed.benefits) && parsed.benefits.length ? parsed.benefits.slice(0, 3).map(String) : launchCopy.benefits,
      products: mergeProductCopy(launchCopy.products, parsed.products),
    };
  } catch {
    return launchCopy;
  }
}

function mergeProductCopy(products, nextProducts) {
  if (!Array.isArray(nextProducts)) return products;
  return products.map((product) => {
    const next = nextProducts.find((item) => item && item.name === product.name);
    return next?.description ? { ...product, description: String(next.description) } : product;
  });
}

function buildWeekOneChecklist(profile, corpus, brand, market) {
  return [
    `Reserve handles for ${brand.winner.name} on Instagram, TikTok, Etsy, and a simple domain.`,
    'Photograph or mock up the three launch bars in the same light and background.',
    'Publish the landing page and send the URL to 20 people who would give honest feedback.',
    'Ask testers to pick one product and explain why in one sentence.',
    'Post three process clips: mixing, cutting, and wrapping.',
    'Set the starter trio price using the observed $24-$42 bundle range.',
    'Draft one Etsy starter trio listing, but wait to publish until photos and shipping costs are confirmed.',
    ...corpus.weekOneActions.slice(4, 6),
  ];
}

async function callOllama(config, messages) {
  const response = await fetchJson(`${config.ollamaHost}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      temperature: config.temperature ?? 0.5,
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

function stringOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function renderMarketResearch(market) {
  return `# Market Research\n\n${market.summary}\n\n## Competitors\n\n${market.competitors.map((item) => `- **${item.name}**: ${item.positioning}\n  - Prices: ${item.observedPrices.join(', ')}\n  - Working: ${item.whatWorks}\n  - Gap: ${item.gap}`).join('\n')}\n\n## Price Points\n\n${market.pricePoints.map((item) => `- **${item.channel}**: ${item.range}. ${item.signal}`).join('\n')}\n\n## Buyer Language\n\n${market.buyerLanguage.map((item) => `- ${item}`).join('\n')}\n\n## Gaps\n\n${market.gaps.map((item) => `- ${item}`).join('\n')}\n`;
}

function renderBrand(brand) {
  return `# Brand\n\nWinner: **${brand.winner.name}**\n\nTagline: ${brand.tagline}\n\nPositioning: ${brand.positioning}\n\n## Options\n\n${brand.options.map((option) => `- **${option.name}** (${option.score}/100): ${option.rationale}`).join('\n')}\n\n## Visual Direction\n\n- Colors: ${brand.visualDirection.colors.join(', ')}\n- Style: ${brand.visualDirection.style}\n`;
}

function renderProductCopy(copy) {
  return `# Product Copy\n\n## Homepage\n\n${copy.headline}\n\n${copy.subheadline}\n\n## Benefits\n\n${copy.benefits.map((item) => `- ${item}`).join('\n')}\n\n## Products\n\n${copy.products.map((product) => `### ${product.name}\n\n${product.description}\n\nPrice: $${product.price}`).join('\n\n')}\n\n## About\n\n${copy.about}\n`;
}

function renderChecklist(items) {
  return `# Week One Checklist\n\n${items.map((item) => `- [ ] ${item}`).join('\n')}\n`;
}

function renderReportHtml(profile, market, brand, copy, checklist) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Side Project Launcher</title>
<style>
:root{--ink:#1d2520;--muted:#66736b;--line:#d9e0d8;--bg:#f6f7f4;--panel:#fff;--sage:#486b57;--clay:#a15c3b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1120px;margin:0 auto;padding:34px 20px 56px}h1{font-size:34px;line-height:1.1;margin:0 0 8px}h2{font-size:22px;margin:0 0 12px}.muted{color:var(--muted)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;margin:0 0 18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.brand{font-size:28px;color:var(--sage);font-weight:750}.cta{display:inline-block;background:var(--sage);color:white;text-decoration:none;border-radius:6px;padding:10px 14px}li{margin:0 0 8px}a{color:var(--sage)}
@media(max-width:800px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body><main>
<h1>Side Project Launcher</h1>
<section class="panel"><p><strong>Idea:</strong> ${escapeHtml(profile.idea)}</p><p class="muted">Category: ${escapeHtml(profile.category)} &middot; Founder: ${escapeHtml(profile.founderName)}</p><p><a class="cta" href="landing-page/index.html">Open live landing page</a></p></section>
<section class="grid">
  <div class="panel"><h2>Brand</h2><div class="brand">${escapeHtml(brand.winner.name)}</div><p>${escapeHtml(brand.tagline)}</p><p>${escapeHtml(brand.positioning)}</p></div>
  <div class="panel"><h2>Market Snapshot</h2><p>${escapeHtml(market.summary)}</p><ul>${market.gaps.slice(0, 3).map((gap) => `<li>${escapeHtml(gap)}</li>`).join('')}</ul></div>
</section>
<section class="panel"><h2>Launch Copy</h2><p><strong>${escapeHtml(copy.headline)}</strong></p><p>${escapeHtml(copy.subheadline)}</p><ul>${copy.products.map((product) => `<li><strong>${escapeHtml(product.name)}</strong>: ${escapeHtml(product.description)} <span class="muted">$${product.price}</span></li>`).join('')}</ul></section>
<section class="panel"><h2>Week One Checklist</h2><ul>${checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
</main></body></html>`;
}

function renderLandingPage(profile, brand, copy) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(brand.winner.name)}</title>
<style>
:root{--ink:#1e2721;--muted:#647268;--line:#dde5dc;--bg:#f7f6f0;--cream:#fffdf7;--sage:#456650;--clay:#a15c3b;--charcoal:#303734}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}.nav{height:64px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.logo{font-weight:800;color:var(--sage);font-size:20px}.button,button{background:var(--sage);color:white;border:0;border-radius:6px;padding:11px 14px;font:inherit;cursor:pointer;text-decoration:none}
.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:36px;align-items:center;padding:54px 0 34px}.eyebrow{color:var(--clay);font-weight:750;text-transform:uppercase;font-size:12px;letter-spacing:0}.hero h1{font-size:48px;line-height:1.04;margin:10px 0 14px;letter-spacing:0}.hero p{font-size:18px;color:var(--muted);max-width:620px}.visual{background:var(--cream);border:1px solid var(--line);border-radius:8px;padding:18px}.visual img{display:block;width:100%;height:auto}
.benefits{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding:18px 0 34px}.benefit,.product,.about,.capture{background:var(--cream);border:1px solid var(--line);border-radius:8px;padding:18px}.benefit strong{display:block;margin-bottom:6px}.products{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:14px 0 34px}.product h3{margin:0 0 6px;font-size:20px}.price{font-weight:800;color:var(--sage)}.about{margin-bottom:18px}.capture{margin:0 0 46px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}.capture h2{margin:0}.capture form{display:flex;gap:8px}.capture input{min-width:260px;border:1px solid var(--line);border-radius:6px;padding:11px 12px;font:inherit;background:white}.note{color:var(--muted);font-size:14px}.status{color:var(--sage);font-weight:700}
@media(max-width:850px){.hero,.benefits,.products,.capture{grid-template-columns:1fr}.hero h1{font-size:36px}.capture form{flex-direction:column}.capture input{min-width:0;width:100%}}
</style>
</head>
<body>
<div class="wrap">
  <nav class="nav"><div class="logo">${escapeHtml(brand.winner.name)}</div><a class="button" href="#join">Join first batch</a></nav>
  <section class="hero">
    <div>
      <div class="eyebrow">${escapeHtml(copy.tagline)}</div>
      <h1>${escapeHtml(copy.headline)}</h1>
      <p>${escapeHtml(copy.subheadline)}</p>
      <a class="button" href="#join">${escapeHtml(copy.emailCta)}</a>
    </div>
    <div class="visual"><img src="assets/soap-bars.svg" alt="Illustrated handmade soap bars with botanical ingredients"></div>
  </section>
  <section class="benefits">${copy.benefits.map((benefit) => `<div class="benefit"><strong>${escapeHtml(benefit.split(',')[0])}</strong><span>${escapeHtml(benefit)}</span></div>`).join('')}</section>
  <section><h2>First Batch</h2><div class="products">${copy.products.map((product) => `<article class="product"><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p><p class="price">$${product.price}</p></article>`).join('')}</div></section>
  <section class="about"><h2>About</h2><p>${escapeHtml(copy.about)}</p></section>
  <section class="capture" id="join">
    <div><h2>Get the first batch note</h2><p class="note">No spam. Just launch timing, scent notes, and the first restock window.</p><p class="status" id="status"></p></div>
    <form id="email-form"><input id="email" type="email" placeholder="${escapeHtml(copy.emailPlaceholder)}" required><button type="submit">${escapeHtml(copy.emailCta)}</button></form>
  </section>
</div>
<script>
document.getElementById('email-form').addEventListener('submit', function(event) {
  event.preventDefault();
  const email = document.getElementById('email').value.trim();
  if (!email) return;
  const key = '${slugify(brand.winner.name)}-emails';
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  existing.push({ email, at: new Date().toISOString() });
  localStorage.setItem(key, JSON.stringify(existing));
  document.getElementById('status').textContent = 'Saved. You are on the first batch list.';
  event.target.reset();
});
</script>
</body></html>`;
}

function renderSoapSvg(brand) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620" role="img" aria-label="${escapeHtml(brand.winner.name)} soap bars">
  <rect width="900" height="620" fill="#fffdf7"/>
  <circle cx="720" cy="130" r="78" fill="#e8d6c7"/>
  <circle cx="150" cy="470" r="115" fill="#dfe8dc"/>
  <g transform="translate(150 165)">
    <rect x="0" y="92" width="250" height="150" rx="22" fill="#d7c3a2"/>
    <rect x="38" y="58" width="250" height="150" rx="22" fill="#c7d3b7"/>
    <rect x="78" y="24" width="250" height="150" rx="22" fill="#8a9c83"/>
    <path d="M148 88c40-42 84-50 132-24-34 6-62 23-85 53-16-13-32-23-47-29z" fill="#f5efe3" opacity=".9"/>
    <path d="M96 150c54 28 116 31 182 8" fill="none" stroke="#f5efe3" stroke-width="10" stroke-linecap="round" opacity=".75"/>
  </g>
  <g transform="translate(520 220)">
    <rect x="0" y="0" width="230" height="155" rx="24" fill="#ba7352"/>
    <path d="M52 76c48-34 92-34 132 0" fill="none" stroke="#fff5e8" stroke-width="11" stroke-linecap="round" opacity=".8"/>
    <circle cx="66" cy="46" r="10" fill="#fff5e8" opacity=".8"/>
    <circle cx="168" cy="108" r="8" fill="#fff5e8" opacity=".65"/>
  </g>
  <g fill="#34423a" opacity=".88" font-family="Arial, sans-serif">
    <text x="95" y="80" font-size="34" font-weight="700">${escapeHtml(brand.winner.name)}</text>
    <text x="95" y="118" font-size="20">${escapeHtml(brand.tagline)}</text>
  </g>
</svg>`;
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
    .slice(0, 80) || 'launcher';
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
