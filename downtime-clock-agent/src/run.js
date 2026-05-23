#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from './demo-config.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

const DEFAULTS = {
  name: 'downtime-clock-agent',
  model: 'unsloth/Qwen3.6-35B-A3B-GGUF',
  ollamaHost: 'http://127.0.0.1:8000/v1',
  nodeMinVersion: '22.14.0',
  openclawMinVersion: '2026.5.12',
  sample: {
    machineId: 'MACHINE-4',
  },
};

const config = loadRuntimeConfig(ROOT, DEFAULTS);
const [command = 'help', ...rawArgs] = process.argv.slice(2);
const args = parseArgs(rawArgs);

if (['help', '-h', '--help'].includes(command)) {
  usage();
} else if (command === 'doctor') {
  await doctor(config);
} else if (command === 'run') {
  await runDemo(config, args);
} else {
  console.error(`Unknown command: ${command}`);
  usage(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._ = [...(out._ ?? []), token];
      continue;
    }
    const key = token.slice(2);
    if (['help', 'skip-model'].includes(key)) {
      out[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

function usage(exitCode = 0) {
  console.log(`Usage:
  downtime-clock doctor
  downtime-clock run [--machine MACHINE-4] [--out <dir>] [--skip-model]

Options:
  --machine <id>           Machine to trigger. Default: MACHINE-4.
  --out <dir>              Output directory. Default: runs/<timestamp>-downtime-clock.
  --skip-model             Use deterministic wording instead of calling the model.
  --model <name>           Model id override.`);
  process.exit(exitCode);
}

function commandExists(commandName) {
  const result = spawnSync('bash', ['-lc', `command -v ${shellQuote(commandName)}`], { encoding: 'utf8' });
  return result.status === 0;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function run(commandName, commandArgs = [], options = {}) {
  const result = spawnSync(commandName, commandArgs, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`${commandName} ${commandArgs.join(' ')} failed\n${details}`);
  }
  return result.stdout;
}

function safeRunLabel(commandName, commandArgs = []) {
  try {
    return run(commandName, commandArgs).trim().split('\n')[0] || 'ok';
  } catch (error) {
    return `error: ${error.message.split('\n')[0]}`;
  }
}

async function doctor(configValue) {
  const checks = [];
  const nodeVersion = process.versions.node;
  checks.push(['node', `v${nodeVersion}`]);
  const openclawVersion = commandExists('openclaw') ? safeRunLabel('openclaw', ['--version']) : 'missing';
  const llamaServerOk = await fetchJson(`${configValue.ollamaHost}/models`, {}, 5000).then(() => 'ok').catch((e) => `error: ${e.message}`);
  const pythonPath = commandExists('python3') ? safeRunLabel('bash', ['-lc', 'command -v python3']) : 'missing';
  checks.push(['openclaw', openclawVersion]);
  checks.push(['llama-server', llamaServerOk]);
  checks.push(['python3', pythonPath]);
  checks.push(['downtime-clock-seed', await exists(path.join(ROOT, 'data/downtime-clock-seed.json')) ? 'present' : 'missing']);
  checks.push(['mock-downtime-clock-data', await exists(path.join(ROOT, 'tools/mock-downtime-clock-data')) ? 'present' : 'missing']);

  let ok = true;
  if (!versionAtLeast(nodeVersion, configValue.nodeMinVersion)) ok = false;
  if (openclawVersion === 'missing' || llamaServerOk.startsWith('error:') || pythonPath === 'missing') ok = false;
  if (openclawVersion.startsWith('error:') || llamaServerOk.startsWith('error:')) ok = false;

  let ollamaModels = [];
  try {
    const tags = await fetchJson(`${configValue.ollamaHost}/models`, {}, 8000);
    ollamaModels = (tags.data ?? []).map((m) => m.id);
  } catch (error) {
    checks.push(['llama-server-api', `error: ${error.message}`]);
    ok = false;
  }

  for (const [name, value] of checks) {
    console.log(`${name}: ${value}`);
  }
  if (openclawVersion !== 'missing') {
    const found = openclawVersion.match(/(\d{4}\.\d+\.\d+)/)?.[1];
    const versionOk = found ? versionAtLeast(found, configValue.openclawMinVersion) : false;
    console.log(`openclaw min version: ${configValue.openclawMinVersion}`);
    console.log(`openclaw version ok: ${versionOk ? 'yes' : 'no'}`);
    if (!versionOk) ok = false;
  }
  console.log(`configured model: ${configValue.model}`);
  const modelInstalled = ollamaModels.includes(configValue.model);
  console.log(`model installed: ${modelInstalled ? 'yes' : 'no'}`);
  if (!modelInstalled) ok = false;
  if (!ok) process.exitCode = 1;
}

async function runDemo(configValue, argsValue) {
  const model = argsValue.model ?? configValue.model;
  const effectiveConfig = { ...configValue, model };
  const machine = argsValue.machine ?? configValue.sample?.machineId ?? 'MACHINE-4';
  const outDir = path.resolve(argsValue.out ?? path.join(ROOT, 'runs', `${timestamp()}-${slugify(machine)}-downtime-clock`));
  const toolDir = path.join(outDir, 'tool-responses');
  await fs.mkdir(toolDir, { recursive: true });

  console.log(`Machine: ${machine}`);
  console.log(`Output: ${outDir}`);

  const payload = collectData(machine);
  await writeJson(path.join(toolDir, 'downtime-clock-data.json'), payload);

  const [revenue, cascade, history] = await Promise.all([
    calculateRevenue(payload),
    trackCascade(payload),
    pullHistory(payload),
  ]);
  const comparator = compareRepairCost(payload, revenue, cascade);
  let executiveSummary = summarizeExecutive(payload, revenue, cascade, comparator, history);
  if (!argsValue['skip-model']) {
    executiveSummary = await polishSummaryWithFallback(effectiveConfig, executiveSummary, { payload, revenue, cascade, comparator, history });
  }

  const analysis = {
    generatedAt: new Date().toISOString(),
    event: payload.event,
    revenue,
    cascade,
    comparator,
    history,
    executiveSummary,
  };

  await fs.writeFile(path.join(outDir, 'executive-summary.md'), renderExecutiveSummary(executiveSummary, comparator, history));
  await fs.writeFile(path.join(outDir, 'revenue-clock.md'), renderRevenueClock(revenue));
  await fs.writeFile(path.join(outDir, 'cascade-tracker.md'), renderCascadeTracker(cascade));
  await fs.writeFile(path.join(outDir, 'break-even.md'), renderBreakEven(comparator));
  await fs.writeFile(path.join(outDir, 'history.md'), renderHistory(history));
  await writeJson(path.join(outDir, 'analysis.json'), analysis);
  await fs.writeFile(path.join(outDir, 'index.html'), renderReportHtml(analysis));

  console.log(`Initial loss rate: ${formatMoney(comparator.initialRatePerMinute)}/minute`);
  console.log(`Rate after cascade: ${formatMoney(comparator.rateAtThirtyMinutes)}/minute at downtime minute 30`);
  console.log(`Repair cost: ${formatMoney(comparator.repairCost)}`);
  console.log(`Break-even: downtime minute ${comparator.breakEvenMinute.toFixed(1)}`);
  console.log(`History: ${history.unplannedEventsThisQuarterIncludingCurrent}th unplanned event this quarter, ${formatMoney(history.annualizedDowntimeCost)} annualized`);
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
}

function collectData(machine) {
  const stdout = run(path.join(ROOT, 'tools/mock-downtime-clock-data'), ['event', machine], { timeout: 30000 });
  return JSON.parse(stdout);
}

async function calculateRevenue(payload) {
  const jobs = payload.productionSchedule.map((job) => {
    const marginPerMinute = (job.unitsPerHour * job.contributionMarginPerUnit) / 60;
    const totalRemainingMargin = job.unitsRemaining * job.contributionMarginPerUnit;
    return {
      ...job,
      marginPerMinute,
      totalRemainingMargin,
    };
  });
  const stages = jobs.map((job) => ({
    minute: job.startsAtDowntimeMinute,
    deltaPerMinute: job.marginPerMinute,
    label: `${job.jobId} ${job.part}`,
    source: job.customer,
    type: 'revenue',
  })).sort((left, right) => left.minute - right.minute);
  return {
    machineId: payload.event.machineId,
    jobs,
    stages,
    currentJob: jobs.find((job) => job.status === 'running'),
    queuedJobs: jobs.filter((job) => job.status === 'queued'),
    totalRemainingMargin: jobs.reduce((sum, job) => sum + job.totalRemainingMargin, 0),
  };
}

async function trackCascade(payload) {
  const stations = payload.downstreamStations.map((station) => ({
    ...station,
    triggerMinute: station.bufferMinutes,
  }));
  const stages = stations.map((station) => ({
    minute: station.triggerMinute,
    deltaPerMinute: station.idleLaborCostPerMinute,
    label: `${station.name} starving`,
    source: `${station.crew} crew idle`,
    type: 'labor',
  })).sort((left, right) => left.minute - right.minute);
  return {
    stations,
    stages,
    totalIdleLaborAtFullCascade: stations.reduce((sum, station) => sum + station.idleLaborCostPerMinute, 0),
  };
}

async function pullHistory(payload) {
  const history = payload.history;
  const priorLoss = history.priorEvents.reduce((sum, event) => sum + event.loss, 0);
  return {
    ...history,
    priorQuarterLoss: priorLoss,
    repeatedCauseCount: history.priorEvents.filter((event) => /spindle drive/i.test(event.cause)).length + 1,
    rebuildPaybackMonths: (history.rebuildCost / (history.annualizedDowntimeCost / 12)),
  };
}

function compareRepairCost(payload, revenue, cascade) {
  const stages = [...revenue.stages, ...cascade.stages].sort((left, right) => left.minute - right.minute || left.type.localeCompare(right.type));
  const rateTimeline = buildRateTimeline(stages);
  const repairCost = payload.repair.totalCost;
  const breakEvenMinute = findBreakEvenMinute(rateTimeline, repairCost);
  return {
    repair: payload.repair,
    repairCost,
    stages,
    rateTimeline,
    initialRatePerMinute: rateAtMinute(rateTimeline, 0),
    rateAtBreakEven: rateAtMinute(rateTimeline, breakEvenMinute),
    rateAtThirtyMinutes: rateAtMinute(rateTimeline, 30),
    costAtThirtyMinutes: cumulativeCostAtMinute(rateTimeline, 30),
    breakEvenMinute,
    breakEvenStatement: `At the current accelerating loss rate, downtime exceeds the ${formatMoney(repairCost)} repair cost at downtime minute ${breakEvenMinute.toFixed(1)}.`,
  };
}

function buildRateTimeline(stages) {
  const grouped = new Map();
  for (const stage of stages) {
    const item = grouped.get(stage.minute) ?? { minute: stage.minute, deltaPerMinute: 0, events: [] };
    item.deltaPerMinute += stage.deltaPerMinute;
    item.events.push(stage);
    grouped.set(stage.minute, item);
  }
  let rate = 0;
  return [...grouped.values()]
    .sort((left, right) => left.minute - right.minute)
    .map((item) => {
      rate += item.deltaPerMinute;
      return {
        minute: item.minute,
        deltaPerMinute: item.deltaPerMinute,
        totalRatePerMinute: rate,
        events: item.events,
      };
    });
}

function rateAtMinute(timeline, minute) {
  let rate = 0;
  for (const stage of timeline) {
    if (stage.minute <= minute) rate = stage.totalRatePerMinute;
  }
  return rate;
}

function cumulativeCostAtMinute(timeline, minute) {
  if (!timeline.length || minute <= timeline[0].minute) return 0;
  let cost = 0;
  for (let i = 0; i < timeline.length; i += 1) {
    const current = timeline[i];
    const nextMinute = timeline[i + 1]?.minute ?? minute;
    const start = current.minute;
    const end = Math.min(minute, nextMinute);
    if (end > start) {
      cost += current.totalRatePerMinute * (end - start);
    }
    if (minute <= nextMinute) break;
  }
  return cost;
}

function findBreakEvenMinute(timeline, repairCost) {
  let cost = 0;
  for (let i = 0; i < timeline.length; i += 1) {
    const current = timeline[i];
    const nextMinute = timeline[i + 1]?.minute ?? Number.POSITIVE_INFINITY;
    const span = nextMinute - current.minute;
    const segmentCost = current.totalRatePerMinute * span;
    if (cost + segmentCost >= repairCost) {
      return current.minute + ((repairCost - cost) / current.totalRatePerMinute);
    }
    cost += segmentCost;
  }
  return 0;
}

function summarizeExecutive(payload, revenue, cascade, comparator, history) {
  const current = revenue.currentJob;
  return `Machine 4 is costing ${formatMoney(comparator.initialRatePerMinute)} per downtime minute immediately from ${current.jobId} (${current.customer}). The rate accelerates as queued jobs and downstream stations starve, reaching ${formatMoney(comparator.rateAtThirtyMinutes)} per minute by downtime minute 30. The ${formatMoney(comparator.repairCost)} repair cost is crossed at minute ${comparator.breakEvenMinute.toFixed(1)}. This is the ${history.unplannedEventsThisQuarterIncludingCurrent}th unplanned Machine 4 event this quarter; annualized downtime cost is ${formatMoney(history.annualizedDowntimeCost)} against an ${formatMoney(history.rebuildCost)} rebuild.`;
}

async function polishSummaryWithFallback(configValue, fallback, context) {
  try {
    const prompt = await fs.readFile(path.join(ROOT, configValue.claws.historian), 'utf8');
    const response = await callOllama(configValue, [
      { role: 'system', content: `${prompt}\nReturn one CFO-ready paragraph. Keep all numbers unchanged.` },
      { role: 'user', content: `/no_think\n${JSON.stringify({ fallback, context })}` },
    ]);
    return response.trim().split(/\n+/).join(' ').slice(0, 900) || fallback;
  } catch {
    return fallback;
  }
}

async function callOllama(configValue, messages) {
  const response = await fetchJson(`${configValue.ollamaHost}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: configValue.model,
      messages,
      stream: false,
      temperature: configValue.temperature ?? 0.22,
      max_tokens: configValue.maxOutputTokens ?? 2048,
    }),
  }, 180000);
  return response.choices?.[0]?.message?.content ?? '';
}

function renderExecutiveSummary(summary, comparator, history) {
  return `# Executive Summary

${summary}

- Repair cost: ${formatMoney(comparator.repairCost)}
- Break-even: downtime minute ${comparator.breakEvenMinute.toFixed(1)}
- Loss rate at break-even: ${formatMoney(comparator.rateAtBreakEven)}/minute
- Loss at downtime minute 30: ${formatMoney(comparator.costAtThirtyMinutes)}
- Quarter events: ${history.unplannedEventsThisQuarterIncludingCurrent}
- Annualized downtime cost: ${formatMoney(history.annualizedDowntimeCost)}
- Rebuild cost: ${formatMoney(history.rebuildCost)}
- Rebuild payback: ${history.rebuildPaybackMonths.toFixed(1)} months
`;
}

function renderRevenueClock(revenue) {
  return `# Revenue Clock

Total remaining contribution margin exposed on Machine 4: ${formatMoney(revenue.totalRemainingMargin)}

${revenue.jobs.map((job) => `## ${job.jobId}: ${job.part}

- Customer: ${job.customer}
- Status: ${job.status}
- Starts contributing to clock: downtime minute ${job.startsAtDowntimeMinute}
- Throughput: ${job.unitsPerHour} units/hour
- Margin per unit: ${formatMoney(job.contributionMarginPerUnit)}
- Loss rate: ${formatMoney(job.marginPerMinute)}/minute
- Remaining margin: ${formatMoney(job.totalRemainingMargin)}
- Commit risk: ${job.commitRisk}
`).join('\n')}`;
}

function renderCascadeTracker(cascade) {
  return `# Cascade Tracker

Full downstream cascade adds ${formatMoney(cascade.totalIdleLaborAtFullCascade)}/minute in idle labor cost.

${cascade.stations.map((station) => `## ${station.name}

- Buffer before starvation: ${station.bufferMinutes} minutes
- Crew idle when starved: ${station.crew}
- Added labor cost: ${formatMoney(station.idleLaborCostPerMinute)}/minute
- Clock trigger: downtime minute ${station.triggerMinute}
`).join('\n')}`;
}

function renderBreakEven(comparator) {
  return `# Break-Even

${comparator.breakEvenStatement}

## Repair Cost

- Parts: ${formatMoney(comparator.repair.parts.reduce((sum, part) => sum + part.cost, 0))}
- Labor: ${formatMoney(comparator.repair.laborCost)}
- Expedite: ${formatMoney(comparator.repair.expediteCost)}
- Outside service: ${formatMoney(comparator.repair.outsideServiceCost)}
- Total: ${formatMoney(comparator.repairCost)}
- Estimated repair time: ${comparator.repair.estimatedRepairMinutes} minutes

## Rate Timeline

${comparator.rateTimeline.map((stage) => `- Minute ${stage.minute}: +${formatMoney(stage.deltaPerMinute)}/minute, total ${formatMoney(stage.totalRatePerMinute)}/minute (${stage.events.map((event) => event.label).join('; ')})`).join('\n')}
`;
}

function renderHistory(history) {
  return `# Machine 4 History

- Quarter: ${history.quarter}
- Unplanned events this quarter including current: ${history.unplannedEventsThisQuarterIncludingCurrent}
- Average repair time: ${history.averageRepairMinutes} minutes
- Prior quarter loss before current event: ${formatMoney(history.priorQuarterLoss)}
- Annualized downtime cost: ${formatMoney(history.annualizedDowntimeCost)}
- Rebuild cost: ${formatMoney(history.rebuildCost)}
- Rebuild lead time: ${history.rebuildLeadTimeDays} days
- Rebuild payback: ${history.rebuildPaybackMonths.toFixed(1)} months
- Spindle-drive-related events including current: ${history.repeatedCauseCount}

## Prior Events

${history.priorEvents.map((event) => `- ${event.date}: ${event.minutesDown} minutes, ${formatMoney(event.loss)}, ${event.cause}`).join('\n')}
`;
}

function renderReportHtml(analysis) {
  const clockPayload = {
    event: analysis.event,
    repairCost: analysis.comparator.repairCost,
    breakEvenMinute: analysis.comparator.breakEvenMinute,
    timeline: analysis.comparator.rateTimeline,
    jobs: analysis.revenue.jobs,
    stations: analysis.cascade.stations,
    history: analysis.history,
    executiveSummary: analysis.executiveSummary,
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Downtime Clock</title>
<style>
:root{color-scheme:light;--ink:#15191f;--muted:#5e6978;--line:#d8dee8;--bg:#f3f5f7;--panel:#fff;--red:#b42318;--green:#177245;--amber:#a15c00;--blue:#2556d6}
*{box-sizing:border-box}
body{margin:0;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
main{max-width:1220px;margin:0 auto;padding:28px 20px 56px}
header{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:end;margin-bottom:18px}
h1{font-size:38px;line-height:1.05;margin:0 0 8px}
h2{font-size:18px;margin:0 0 12px}
.lede{margin:0;color:var(--muted);font-size:17px;max-width:820px}
.pill{border:1px solid var(--line);border-radius:8px;background:#fff;padding:8px 10px;color:var(--muted)}
.grid{display:grid;grid-template-columns:1.3fr .7fr;gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.clock{border:2px solid var(--ink)}
.clock.crossed{border-color:var(--red);box-shadow:0 0 0 4px rgba(180,35,24,.08)}
.label{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
#cost{font-size:72px;line-height:.95;font-weight:800;letter-spacing:0;margin:10px 0 8px}
#rate{font-size:22px;font-weight:700;color:var(--blue)}
#breakStatus{margin-top:12px;padding:12px;border-radius:8px;background:#eef3ff;color:#1d3f9c;font-weight:700}
.crossed #breakStatus{background:#ffe7e4;color:var(--red)}
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}
.metric{border:1px solid var(--line);border-radius:8px;padding:12px;background:#fafbfc}
.metric strong{display:block;font-size:24px;margin-top:4px}
.list{display:grid;gap:8px}
.row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:10px;background:#fafbfc}
.state{font-weight:700;color:var(--green)}
.state.active{color:var(--amber)}
.state.starved,.state.risk{color:var(--red)}
.history strong{font-size:26px}
.summary{font-size:17px;color:#27313d}
@media(max-width:860px){header,.grid,.metrics{grid-template-columns:1fr}#cost{font-size:52px}}
</style>
</head>
<body>
<main>
<header>
  <div>
    <h1>The Downtime Clock</h1>
    <p class="lede">Machine 4 just went down. The clock shows actual margin at risk, downstream labor starvation, repair break-even, and machine history while the number keeps moving.</p>
  </div>
  <div class="pill">${escapeHtml(analysis.event.demoTimeScale.label)}</div>
</header>
<section class="grid">
  <div class="card clock" id="clockCard">
    <span class="label">Accumulated downtime loss</span>
    <div id="cost">$0</div>
    <div id="rate">$0/minute right now</div>
    <div id="breakStatus"></div>
    <div class="metrics">
      <div class="metric"><span class="label">Downtime minute</span><strong id="minute">0.0</strong></div>
      <div class="metric"><span class="label">Repair cost</span><strong id="repairCost"></strong></div>
      <div class="metric"><span class="label">Break-even</span><strong id="breakEven"></strong></div>
    </div>
  </div>
  <div class="card history">
    <h2>Historical Context</h2>
    <span class="label">This quarter</span>
    <strong>${analysis.history.unplannedEventsThisQuarterIncludingCurrent}th unplanned event</strong>
    <p>${formatMoney(analysis.history.annualizedDowntimeCost)} annualized downtime cost. Rebuild cost: ${formatMoney(analysis.history.rebuildCost)}. Payback: ${analysis.history.rebuildPaybackMonths.toFixed(1)} months.</p>
  </div>
</section>
<section class="grid" style="margin-top:16px">
  <div class="card">
    <h2>Revenue At Risk</h2>
    <div class="list" id="jobs"></div>
  </div>
  <div class="card">
    <h2>Cascade Tracker</h2>
    <div class="list" id="stations"></div>
  </div>
</section>
<section class="card" style="margin-top:16px">
  <h2>Executive Readout</h2>
  <p class="summary">${escapeHtml(analysis.executiveSummary)}</p>
</section>
</main>
<script type="application/json" id="clockData">${safeJsonForScript(clockPayload)}</script>
<script>
const data = JSON.parse(document.getElementById('clockData').textContent);
const startedAt = performance.now();
const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const oneMinuteMs = data.event.demoTimeScale.realSecondsPerDowntimeMinute * 1000;
function rateAt(minute) {
  let rate = 0;
  for (const stage of data.timeline) {
    if (stage.minute <= minute) rate = stage.totalRatePerMinute;
  }
  return rate;
}
function cumulativeAt(minute) {
  if (!data.timeline.length) return 0;
  let cost = 0;
  for (let i = 0; i < data.timeline.length; i++) {
    const current = data.timeline[i];
    const next = data.timeline[i + 1]?.minute ?? minute;
    const start = current.minute;
    const end = Math.min(minute, next);
    if (end > start) cost += current.totalRatePerMinute * (end - start);
    if (minute <= next) break;
  }
  return cost;
}
function jobState(job, minute) {
  if (minute >= job.startsAtDowntimeMinute) return ['COUNTING', 'active'];
  return [Math.ceil(job.startsAtDowntimeMinute - minute) + ' min until queued margin hits', ''];
}
function stationState(station, minute) {
  if (minute >= station.triggerMinute) return ['STARVING', 'starved'];
  return [Math.ceil(station.triggerMinute - minute) + ' min buffer', ''];
}
function drawRows(minute) {
  document.getElementById('jobs').innerHTML = data.jobs.map(job => {
    const [state, cls] = jobState(job, minute);
    return '<div class="row"><div><strong>' + job.jobId + '</strong><br><span class="label">' + job.customer + ' - ' + job.part + '</span></div><div class="state ' + cls + '">' + state + '<br>' + fmt.format(job.marginPerMinute) + '/min</div></div>';
  }).join('');
  document.getElementById('stations').innerHTML = data.stations.map(station => {
    const [state, cls] = stationState(station, minute);
    return '<div class="row"><div><strong>' + station.name + '</strong><br><span class="label">' + station.crew + ' crew, buffer ' + station.bufferMinutes + ' min</span></div><div class="state ' + cls + '">' + state + '<br>' + fmt.format(station.idleLaborCostPerMinute) + '/min</div></div>';
  }).join('');
}
function tick() {
  const minute = (performance.now() - startedAt) / oneMinuteMs;
  const cost = cumulativeAt(minute);
  const rate = rateAt(minute);
  const crossed = cost >= data.repairCost;
  document.getElementById('cost').textContent = fmt.format(cost);
  document.getElementById('rate').textContent = fmt.format(rate) + '/minute right now';
  document.getElementById('minute').textContent = minute.toFixed(1);
  document.getElementById('repairCost').textContent = fmt.format(data.repairCost);
  document.getElementById('breakEven').textContent = 'minute ' + data.breakEvenMinute.toFixed(1);
  document.getElementById('breakStatus').textContent = crossed
    ? 'BREAK-EVEN CROSSED: downtime has passed repair cost by ' + fmt.format(cost - data.repairCost)
    : 'Break-even in ' + Math.max(0, data.breakEvenMinute - minute).toFixed(1) + ' downtime minutes';
  document.getElementById('clockCard').classList.toggle('crossed', crossed);
  drawRows(minute);
  requestAnimationFrame(tick);
}
tick();
</script>
</body>
</html>`;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

function versionAtLeast(actual, required) {
  const parse = (value) => String(value).replace(/^v/, '').split('.').map((part) => Number(part));
  const left = parse(actual);
  const right = parse(required);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function timestamp() {
  return new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run';
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function safeJsonForScript(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}
