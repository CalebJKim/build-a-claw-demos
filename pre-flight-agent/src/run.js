#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from './demo-config.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

const DEFAULTS = {
  name: 'pre-flight-agent',
  model: 'unsloth/Qwen3.6-35B-A3B-GGUF',
  ollamaHost: 'http://127.0.0.1:8000/v1',
  nodeMinVersion: '22.14.0',
  openclawMinVersion: '2026.5.12',
  sample: {
    scenario: 'dual',
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
  pre-flight doctor
  pre-flight run [--scenario dual|wait-smart|run-now-smart] [--out <dir>] [--skip-model]

Options:
  --scenario <id>          Seeded scenario to run. Default: dual.
  --out <dir>              Output directory. Default: runs/<timestamp>-pre-flight.
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
  checks.push(['preflight-seed', await exists(path.join(ROOT, 'data/preflight-seed.json')) ? 'present' : 'missing']);
  checks.push(['mock-preflight-data', await exists(path.join(ROOT, 'tools/mock-preflight-data')) ? 'present' : 'missing']);

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
  const scenarioId = argsValue.scenario ?? configValue.sample?.scenario ?? 'dual';
  const outDir = path.resolve(argsValue.out ?? path.join(ROOT, 'runs', `${timestamp()}-${slugify(scenarioId)}-pre-flight`));
  const toolDir = path.join(outDir, 'tool-responses');
  await fs.mkdir(toolDir, { recursive: true });

  console.log(`Scenario: ${scenarioId}`);
  console.log(`Output: ${outDir}`);

  const payload = collectData(scenarioId);
  await writeJson(path.join(toolDir, 'preflight-data.json'), payload);

  const analyses = await Promise.all(payload.scenarios.map((scenario) => analyzeScenario(scenario)));
  for (const analysis of analyses) {
    if (!argsValue['skip-model']) {
      analysis.forecast.summary = await polishForecastWithFallback(effectiveConfig, analysis.forecast.summary, analysis);
    }
  }

  const comparison = buildComparison(analyses);
  const output = {
    generatedAt: new Date().toISOString(),
    plant: payload.plant,
    asOf: payload.asOf,
    scenario: scenarioId,
    analyses,
    comparison,
  };

  await fs.writeFile(path.join(outDir, 'job-analysis.md'), renderJobAnalysis(analyses));
  await fs.writeFile(path.join(outDir, 'machine-assessment.md'), renderMachineAssessment(analyses));
  await fs.writeFile(path.join(outDir, 'context-reading.md'), renderContextReading(analyses));
  await fs.writeFile(path.join(outDir, 'forecast.md'), renderForecast(analyses));
  await fs.writeFile(path.join(outDir, 'comparison.md'), renderComparison(comparison));
  await writeJson(path.join(outDir, 'analysis.json'), output);
  await fs.writeFile(path.join(outDir, 'index.html'), renderReportHtml(output));

  console.log(`Scenarios analyzed: ${analyses.length}`);
  for (const analysis of analyses) {
    console.log(`${analysis.scenario.id}: ${analysis.forecast.recommendation}`);
    console.log(`  FPY: ${percent(analysis.forecast.currentYield)} now vs ${percent(analysis.forecast.bestYield)} best available`);
    console.log(`  Cost delta: ${formatMoney(Math.abs(analysis.forecast.costDelta))} ${analysis.forecast.costDelta >= 0 ? 'savings if waiting' : 'extra cost if waiting'}`);
  }
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
}

function collectData(scenarioId) {
  const stdout = run(path.join(ROOT, 'tools/mock-preflight-data'), ['scenario', scenarioId], { timeout: 30000 });
  return JSON.parse(stdout);
}

async function analyzeScenario(scenario) {
  const [job, machine, context] = await Promise.all([
    analyzeJob(scenario),
    assessMachine(scenario),
    readContext(scenario),
  ]);
  const forecast = forecastScenario(scenario, job, machine, context);
  return {
    scenario: {
      id: scenario.id,
      title: scenario.title,
    },
    job,
    machine,
    context,
    forecast,
  };
}

async function analyzeJob(scenario) {
  const job = scenario.job;
  const toleranceRisk = job.tightestToleranceInches <= 0.001 ? 28 : job.tightestToleranceInches <= 0.003 ? 14 : 6;
  const materialRisk = /inconel|titanium/i.test(job.material) ? 24 : /aluminum/i.test(job.material) ? 6 : 14;
  const geometryRisk = /5-axis|thin-wall|intersecting/i.test(job.complexity) ? 24 : /pocket|gasket/i.test(job.complexity) ? 12 : 8;
  const customerRisk = /zero|full dimensional|Cpk|dock/i.test(job.customerRequirement) ? 14 : 8;
  const quantityRisk = job.quantity >= 150 ? 7 : job.quantity >= 50 ? 5 : 3;
  const score = clamp(toleranceRisk + materialRisk + geometryRisk + customerRisk + quantityRisk, 0, 100);
  return {
    jobId: job.jobId,
    partFamily: job.partFamily,
    geometry: job.geometry,
    material: job.material,
    quantity: job.quantity,
    dueAt: job.dueAt,
    tightestToleranceInches: job.tightestToleranceInches,
    customerRequirement: job.customerRequirement,
    materialCert: job.materialCert,
    reworkCostPerFailedUnit: job.reworkCostPerFailedUnit,
    escapeRiskReserve: job.escapeRiskReserve,
    inherentDifficultyScore: score,
    drivers: [
      `${job.geometry}: ${job.complexity}`,
      `${job.material} with tightest tolerance ${job.tightestToleranceInches.toFixed(4)} inches`,
      job.customerRequirement,
      job.materialCert,
    ],
  };
}

async function assessMachine(scenario) {
  const current = scenario.current;
  const best = scenario.bestAvailable;
  return {
    current: {
      machineId: current.machineId,
      calibrationDaysAgo: current.calibrationDaysAgo,
      similarJobFpy60d: current.similarJobFpy60d,
      openWorkOrders: current.openWorkOrders,
      machineReadinessScore: clamp(Math.round(current.similarJobFpy60d * 100) - current.openWorkOrders.length * 7 - Math.max(0, current.calibrationDaysAgo - 21), 0, 100),
    },
    bestAvailable: {
      machineId: best.machineId,
      availableInHours: best.availableInHours,
      calibrationDaysAgo: best.calibrationDaysAgo,
      similarJobFpy60d: best.similarJobFpy60d,
      openWorkOrders: best.openWorkOrders,
      machineReadinessScore: clamp(Math.round(best.similarJobFpy60d * 100) - best.openWorkOrders.length * 7 - Math.max(0, best.calibrationDaysAgo - 21), 0, 100),
    },
    liftPoints: Math.round((best.similarJobFpy60d - current.similarJobFpy60d) * 100),
  };
}

async function readContext(scenario) {
  const current = scenario.current;
  const best = scenario.bestAvailable;
  return {
    current: {
      operator: current.operator,
      shift: current.shift,
      operatorMaterialRuns: current.operatorMaterialRuns,
      operatorGeometryRuns: current.operatorGeometryRuns,
      shopLoad: current.shopLoad,
      ambientTempF: current.ambientTempF,
      humidityPercent: current.humidityPercent,
    },
    bestAvailable: {
      operator: best.operator,
      shift: best.shift,
      availableInHours: best.availableInHours,
      operatorMaterialRuns: best.operatorMaterialRuns,
      operatorGeometryRuns: best.operatorGeometryRuns,
      shopLoad: best.shopLoad,
      ambientTempF: best.ambientTempF,
      humidityPercent: best.humidityPercent,
    },
    betterConditionAvailable: best.availableInHours <= 4,
    operatorExperienceLift: Math.max(0, best.operatorGeometryRuns - current.operatorGeometryRuns),
  };
}

function forecastScenario(scenario, job, machine, context) {
  const currentYield = scenario.current.yieldProbability;
  const bestYield = scenario.bestAvailable.yieldProbability;
  const quantity = scenario.job.quantity;
  const reworkCost = scenario.job.reworkCostPerFailedUnit;
  const currentFailures = quantity * (1 - currentYield);
  const bestFailures = quantity * (1 - bestYield);
  const currentReworkCost = currentFailures * reworkCost;
  const bestReworkCost = bestFailures * reworkCost;
  const currentRiskReserve = scenario.job.escapeRiskReserve ?? 0;
  const currentControlledCost = currentReworkCost + currentRiskReserve + scenario.costs.inspectionGateCost;
  const waitTotalCost = bestReworkCost + scenario.costs.waitCost;
  const costDelta = currentControlledCost - waitTotalCost;
  const yieldLift = bestYield - currentYield;
  const shouldWait = costDelta > 0 && yieldLift >= 0.08;
  const needsGate = currentYield < 0.82;
  const recommendation = shouldWait
    ? `WAIT ${scenario.bestAvailable.availableInHours} HOURS FOR ${scenario.bestAvailable.machineId} + OPERATOR ${scenario.bestAvailable.operator.toUpperCase()}`
    : needsGate
      ? 'RUN NOW WITH ADDED INSPECTION GATE'
      : 'RUN NOW';
  const confidence = Math.min(scenario.current.confidence, scenario.bestAvailable.confidence);
  const topFactors = [...scenario.dragFactors].sort((left, right) => right.impactPoints - left.impactPoints);
  const summary = shouldWait
    ? `${percent(currentYield)} likely at current conditions. If you wait ${scenario.bestAvailable.availableInHours} hours for ${scenario.bestAvailable.machineId} and ${scenario.bestAvailable.operator}, that goes to ${percent(bestYield)}. Waiting is cheaper by ${formatMoney(costDelta)} after schedule cost.`
    : `${percent(currentYield)} likely at current conditions. Waiting ${scenario.bestAvailable.availableInHours} hours would raise yield to ${percent(bestYield)}, but the schedule cost makes that ${formatMoney(Math.abs(costDelta))} more expensive than running now with an inspection gate.`;

  return {
    currentYield,
    bestYield,
    yieldLift,
    confidence,
    currentFailures,
    bestFailures,
    currentReworkCost,
    bestReworkCost,
    currentRiskReserve,
    inspectionGateCost: scenario.costs.inspectionGateCost,
    currentControlledCost,
    waitCost: scenario.costs.waitCost,
    waitTotalCost,
    costDelta,
    recommendation,
    scheduleImpact: scenario.costs.scheduleImpact,
    topFactors,
    summary,
    rationale: shouldWait
      ? 'The yield improvement is large and the four-hour wait does not miss the customer commit.'
      : 'The better setup is real, but the wait burns more money than the expected quality loss it avoids.',
  };
}

function buildComparison(analyses) {
  return analyses.map((analysis) => ({
    scenario: analysis.scenario.id,
    title: analysis.scenario.title,
    recommendation: analysis.forecast.recommendation,
    currentYield: analysis.forecast.currentYield,
    bestYield: analysis.forecast.bestYield,
    costDelta: analysis.forecast.costDelta,
    summary: analysis.forecast.summary,
  }));
}

async function polishForecastWithFallback(configValue, fallback, analysis) {
  try {
    const prompt = await fs.readFile(path.join(ROOT, configValue.claws.forecaster), 'utf8');
    const response = await callOllama(configValue, [
      { role: 'system', content: `${prompt}\nReturn one blunt, specific pre-flight recommendation. Keep all numbers unchanged.` },
      { role: 'user', content: `/no_think\n${JSON.stringify({ fallback, analysis })}` },
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
    chat_template_kwargs: { enable_thinking: false },
      temperature: configValue.temperature ?? 0.24,
      max_tokens: configValue.maxOutputTokens ?? 2048,
    }),
  }, 180000);
  return response.choices?.[0]?.message?.content ?? '';
}

function renderJobAnalysis(analyses) {
  return `# Job Analysis

${analyses.map((analysis) => `## ${analysis.job.jobId}: ${analysis.job.geometry}

- Material: ${analysis.job.material}
- Quantity: ${analysis.job.quantity}
- Tightest tolerance: ${analysis.job.tightestToleranceInches.toFixed(4)} inches
- Inherent difficulty score: ${analysis.job.inherentDifficultyScore}/100
- Customer requirement: ${analysis.job.customerRequirement}
- Material cert: ${analysis.job.materialCert}

Drivers:

${analysis.job.drivers.map((driver) => `- ${driver}`).join('\n')}
`).join('\n')}`;
}

function renderMachineAssessment(analyses) {
  return `# Machine Assessment

${analyses.map((analysis) => `## ${analysis.job.jobId}

Current machine: **${analysis.machine.current.machineId}**

- Calibration age: ${analysis.machine.current.calibrationDaysAgo} days
- Similar-job FPY last 60 days: ${percent(analysis.machine.current.similarJobFpy60d)}
- Open work orders: ${analysis.machine.current.openWorkOrders.length ? analysis.machine.current.openWorkOrders.join(', ') : 'none'}
- Machine readiness score: ${analysis.machine.current.machineReadinessScore}/100

Best available inside four hours: **${analysis.machine.bestAvailable.machineId}**

- Available in: ${analysis.machine.bestAvailable.availableInHours} hours
- Calibration age: ${analysis.machine.bestAvailable.calibrationDaysAgo} days
- Similar-job FPY last 60 days: ${percent(analysis.machine.bestAvailable.similarJobFpy60d)}
- Open work orders: ${analysis.machine.bestAvailable.openWorkOrders.length ? analysis.machine.bestAvailable.openWorkOrders.join(', ') : 'none'}
- Machine readiness score: ${analysis.machine.bestAvailable.machineReadinessScore}/100
- Observed machine FPY lift: ${analysis.machine.liftPoints} points
`).join('\n')}`;
}

function renderContextReading(analyses) {
  return `# Context Reading

${analyses.map((analysis) => `## ${analysis.job.jobId}

Current condition:

- Operator: ${analysis.context.current.operator}, shift ${analysis.context.current.shift}
- Experience: ${analysis.context.current.operatorMaterialRuns} runs in material, ${analysis.context.current.operatorGeometryRuns} on geometry
- Shop load: ${analysis.context.current.shopLoad}
- Environment: ${analysis.context.current.ambientTempF} F, ${analysis.context.current.humidityPercent}%

Best available condition:

- Operator: ${analysis.context.bestAvailable.operator}, shift ${analysis.context.bestAvailable.shift}
- Available in: ${analysis.context.bestAvailable.availableInHours} hours
- Experience: ${analysis.context.bestAvailable.operatorMaterialRuns} runs in material, ${analysis.context.bestAvailable.operatorGeometryRuns} on geometry
- Shop load: ${analysis.context.bestAvailable.shopLoad}
- Environment: ${analysis.context.bestAvailable.ambientTempF} F, ${analysis.context.bestAvailable.humidityPercent}%
- Operator geometry experience lift: ${analysis.context.operatorExperienceLift} prior runs
`).join('\n')}`;
}

function renderForecast(analyses) {
  return `# Pre-Flight Forecast

${analyses.map((analysis) => `## ${analysis.job.jobId}: ${analysis.forecast.recommendation}

${analysis.forecast.summary}

- Current first-pass yield probability: ${percent(analysis.forecast.currentYield)}
- Best available first-pass yield probability: ${percent(analysis.forecast.bestYield)}
- Confidence: ${percent(analysis.forecast.confidence)}
- Expected failed units if run now: ${analysis.forecast.currentFailures.toFixed(1)}
- Expected failed units if waiting: ${analysis.forecast.bestFailures.toFixed(1)}
- Expected rework cost running now: ${formatMoney(analysis.forecast.currentReworkCost)}
- Inspection gate cost if running now: ${formatMoney(analysis.forecast.inspectionGateCost)}
- Escape-risk reserve if running now: ${formatMoney(analysis.forecast.currentRiskReserve)}
- Schedule cost of waiting: ${formatMoney(analysis.forecast.waitCost)}
- Expected rework cost after waiting: ${formatMoney(analysis.forecast.bestReworkCost)}
- Net tradeoff: ${analysis.forecast.costDelta >= 0 ? `${formatMoney(analysis.forecast.costDelta)} savings if waiting` : `${formatMoney(Math.abs(analysis.forecast.costDelta))} extra cost if waiting`}

Factors dragging the number down:

${analysis.forecast.topFactors.map((factor, index) => `${index + 1}. ${factor.factor} (${factor.impactPoints} points, ${factor.source})`).join('\n')}
`).join('\n')}`;
}

function renderComparison(comparison) {
  return `# Side-by-Side Decision

${comparison.map((item) => `## ${item.title}

- Scenario: ${item.scenario}
- Recommendation: ${item.recommendation}
- Yield now vs. best available: ${percent(item.currentYield)} -> ${percent(item.bestYield)}
- Cost tradeoff: ${item.costDelta >= 0 ? `${formatMoney(item.costDelta)} savings if waiting` : `${formatMoney(Math.abs(item.costDelta))} extra cost if waiting`}

${item.summary}
`).join('\n')}`;
}

function renderReportHtml(output) {
  const cards = output.analyses.map((analysis) => {
    const f = analysis.forecast;
    const waitWins = f.costDelta >= 0;
    return `<section class="scenario">
      <div class="scenario-head">
        <p class="eyebrow">${escapeHtml(analysis.scenario.id)}</p>
        <h2>${escapeHtml(analysis.job.jobId)} - ${escapeHtml(analysis.job.geometry)}</h2>
        <strong class="${waitWins ? 'rec wait' : 'rec run'}">${escapeHtml(f.recommendation)}</strong>
      </div>
      <p class="summary">${escapeHtml(f.summary)}</p>
      <div class="yield-grid">
        ${yieldBlock('Run now', f.currentYield, analysis.scenario.id)}
        ${yieldBlock(`Best in ${analysis.context.bestAvailable.availableInHours}h`, f.bestYield, `${analysis.scenario.id}-best`)}
      </div>
      <div class="costs">
        <div><span>Run-now controlled cost</span><strong>${formatMoney(f.currentControlledCost)}</strong></div>
        <div><span>Wait total cost</span><strong>${formatMoney(f.waitTotalCost)}</strong></div>
        <div><span>Decision delta</span><strong>${waitWins ? `${formatMoney(f.costDelta)} saved` : `${formatMoney(Math.abs(f.costDelta))} worse if waiting`}</strong></div>
      </div>
      <h3>What is dragging it down</h3>
      <ol>
        ${f.topFactors.slice(0, 5).map((factor) => `<li><strong>${factor.impactPoints} pts</strong> ${escapeHtml(factor.factor)}</li>`).join('')}
      </ol>
      <div class="condition">
        <div><span>Current</span><strong>${escapeHtml(analysis.machine.current.machineId)} + ${escapeHtml(analysis.context.current.operator)}</strong></div>
        <div><span>Better option</span><strong>${escapeHtml(analysis.machine.bestAvailable.machineId)} + ${escapeHtml(analysis.context.bestAvailable.operator)}</strong></div>
        <div><span>Schedule impact</span><strong>${escapeHtml(f.scheduleImpact)}</strong></div>
      </div>
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Pre-Flight</title>
<style>
:root{color-scheme:light;--ink:#17202a;--muted:#5b6572;--line:#d9e0e8;--panel:#ffffff;--bg:#f4f6f8;--green:#13795b;--amber:#a15c00;--blue:#2457d6}
*{box-sizing:border-box}
body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
main{max-width:1180px;margin:0 auto;padding:34px 22px 56px}
header{margin-bottom:22px}
h1{font-size:36px;line-height:1.05;margin:0 0 8px}
h2{font-size:22px;margin:0}
h3{font-size:15px;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.lede{max-width:850px;color:var(--muted);font-size:17px;margin:0}
.meta{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;color:var(--muted)}
.meta span{border:1px solid var(--line);background:#fff;border-radius:8px;padding:6px 10px}
.scenario{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:22px;margin-top:18px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.scenario-head{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start}
.eyebrow{grid-column:1/-1;margin:0;color:var(--blue);font-weight:700;text-transform:uppercase;font-size:12px;letter-spacing:.08em}
.rec{border-radius:6px;padding:8px 10px;font-size:13px;white-space:nowrap}
.rec.wait{background:#eaf6f0;color:var(--green)}
.rec.run{background:#fff2df;color:var(--amber)}
.summary{font-size:17px;margin:16px 0;color:#26313d}
.yield-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.yield{border:1px solid var(--line);border-radius:8px;padding:14px;background:#fafbfc}
.yield span,.costs span,.condition span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.yield strong{display:block;font-size:34px;margin:6px 0}
.bar{height:10px;background:#dde5ee;border-radius:999px;overflow:hidden}
.bar i{display:block;height:100%;background:linear-gradient(90deg,#2457d6,#13795b)}
.costs,.condition{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:16px}
.costs div,.condition div{border:1px solid var(--line);border-radius:8px;padding:12px;background:#fff}
.costs strong,.condition strong{display:block;margin-top:5px}
ol{margin:0;padding-left:22px}
li{margin:6px 0}
@media(max-width:760px){.scenario-head,.yield-grid,.costs,.condition{grid-template-columns:1fr}.rec{white-space:normal}h1{font-size:30px}}
</style>
</head>
<body>
<main>
<header>
  <h1>The Pre-Flight</h1>
  <p class="lede">Before the job runs, the claws compare current conditions against the best available setup inside four hours and make the yield-versus-schedule tradeoff explicit.</p>
  <div class="meta"><span>${escapeHtml(output.plant)}</span><span>${escapeHtml(output.asOf)}</span><span>${output.analyses.length} scenario${output.analyses.length === 1 ? '' : 's'}</span></div>
</header>
${cards}
</main>
</body>
</html>`;
}

function yieldBlock(label, value) {
  return `<div class="yield"><span>${escapeHtml(label)}</span><strong>${percent(value)}</strong><div class="bar"><i style="width:${Math.round(value * 100)}%"></i></div></div>`;
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

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
