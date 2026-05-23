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
  temperature: 0.3,
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
    if (['help', 'skip-model', 'no-send'].includes(key)) {
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
  cascade doctor
  cascade run --machine PRESS-17

Options:
  --skip-model              Use deterministic wording instead of calling the model.
  --no-send                 Draft customer notifications but do not write mock send receipts.
  --machine <id>            Machine downtime trigger. Default from demo.config.json.
  --repair-hours <number>   Estimated repair hours. Default from demo.config.json.
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
  checks.push(['plant-state', existsSync(path.join(ROOT, 'data/plant-state.json')) ? 'present' : 'missing']);
  checks.push(['mock-downtime-event', existsSync(path.join(ROOT, 'tools/mock-downtime-event')) ? 'present' : 'missing']);
  checks.push(['mock-customer-comms', existsSync(path.join(ROOT, 'tools/mock-customer-comms')) ? 'present' : 'missing']);
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
  const machineId = args.machine ?? config.sample?.machineId ?? 'PRESS-17';
  const repairHours = Number(args['repair-hours'] ?? config.sample?.estimatedRepairHours ?? 9);
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'runs', `${timestamp()}-${slugify(machineId)}-cascade`));
  const toolDir = path.join(outDir, 'tool-responses');
  await fs.mkdir(toolDir, { recursive: true });

  console.log(`Trigger: ${machineId} downtime`);
  console.log(`Repair estimate: ${repairHours} hours`);
  console.log(`Output: ${outDir}`);

  const event = await triggerDowntime(machineId, repairHours);
  await writeJson(path.join(toolDir, 'downtime-event.json'), event);

  const [impact, reroute, clock] = await Promise.all([
    Promise.resolve(traceImpact(event)),
    Promise.resolve(rankReroutes(event)),
    Promise.resolve(calculateClock(event)),
  ]);

  let recommendation = reroute.options[0];
  if (!args['skip-model']) {
    recommendation.summary = await polishRecommendationWithFallback(effectiveConfig, event, impact, reroute, clock, recommendation.summary);
  }
  const notifications = buildNotifications(event, impact, recommendation);
  const communication = await executeComms(outDir, notifications, args['no-send']);

  const analysis = {
    generatedAt: new Date().toISOString(),
    event,
    impact,
    reroute,
    clock,
    recommendation,
    notifications,
    communication,
  };

  await fs.writeFile(path.join(outDir, 'downtime-event.md'), renderEventMarkdown(event));
  await fs.writeFile(path.join(outDir, 'blast-radius.md'), renderImpactMarkdown(impact));
  await fs.writeFile(path.join(outDir, 'reroute-options.md'), renderRerouteMarkdown(reroute, recommendation));
  await fs.writeFile(path.join(outDir, 'cost-clock.md'), renderClockMarkdown(clock));
  await fs.writeFile(path.join(outDir, 'customer-notifications.md'), renderNotificationsMarkdown(notifications, communication));
  await writeJson(path.join(outDir, 'analysis.json'), analysis);
  await fs.writeFile(path.join(outDir, 'index.html'), renderReportHtml(event, impact, reroute, clock, recommendation, notifications, communication));

  console.log(`Jobs affected: ${impact.affectedJobs.length}`);
  console.log(`Customers affected: ${notifications.length}`);
  console.log(`Cost rate: $${Math.round(clock.costPerMinute).toLocaleString()}/min`);
  console.log(`Recommended option: ${recommendation.name}`);
  console.log(`Notifications ${communication.sent ? 'sent' : 'drafted'}: ${notifications.length}`);
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
}

async function triggerDowntime(machineId, repairHours) {
  const stdout = run(path.join(ROOT, 'tools/mock-downtime-event'), ['trigger', machineId, String(repairHours)], { timeout: 30000 });
  return JSON.parse(stdout);
}

function traceImpact(event) {
  const plant = event.plantState;
  const machine = plant.machines.find((item) => item.id === event.machineId);
  const detected = new Date(event.detectedAt);
  const repairDone = new Date(detected.getTime() + event.estimatedRepairHours * 60 * 60 * 1000);
  const impactedSchedule = plant.schedule.filter((slot) => slot.machineId === event.machineId && new Date(slot.end) > detected);
  const affectedJobs = impactedSchedule.map((slot) => {
    const job = plant.jobs.find((item) => item.id === slot.jobId);
    const remainingUnits = Math.max(0, job.quantity - job.completedQuantity);
    const delayHours = estimateDelayHours(slot, detected, repairDone);
    return {
      ...job,
      scheduleStart: slot.start,
      scheduleEnd: slot.end,
      remainingUnits,
      marginAtRisk: remainingUnits * job.marginPerUnit,
      delayHours,
      projectedSlipHoursWithoutReroute: delayHours,
    };
  });
  const downstream = machine.downstreamStations.map((stationId) => {
    const station = plant.stations.find((item) => item.id === stationId);
    return {
      ...station,
      starvesAt: new Date(detected.getTime() + station.starvesAfterMinutes * 60 * 1000).toISOString(),
      idleCostPerMinute: station.idleCostPerHour / 60,
    };
  });
  const customers = [...new Set(affectedJobs.map((job) => job.customer))].map((name) => plant.customers.find((customer) => customer.name === name));
  return {
    machine: {
      id: machine.id,
      name: machine.name,
      cell: machine.cell,
      currentJobId: machine.currentJobId,
    },
    detectedAt: event.detectedAt,
    repairDone: repairDone.toISOString(),
    affectedJobs,
    downstream,
    customers,
    summary: `${machine.name} downtime touches ${affectedJobs.length} scheduled jobs, ${downstream.length} downstream stations, and ${customers.length} customer accounts this week.`,
  };
}

function rankReroutes(event) {
  const plant = event.plantState;
  const machine = plant.machines.find((item) => item.id === event.machineId);
  const affectedJobs = plant.jobs.filter((job) => job.route.includes(event.machineId));
  const available = machine.sisterMachines.map((id) => plant.machines.find((item) => item.id === id));
  const totalHours = affectedJobs.reduce((sum, job) => sum + job.remainingMachineHours, 0);

  const optionSplit = buildRerouteOption({
    id: 'split-press-22-12',
    name: 'Split critical work across Press 22 and Press 12',
    machines: [available.find((item) => item.id === 'PRESS-22'), available.find((item) => item.id === 'PRESS-12')],
    totalHours,
    protectedOrders: ['ORD-7718'],
    movedOrders: [
      { orderId: 'ORD-7740', oldCommitDate: '2026-05-22 12:00', newCommitDate: '2026-05-22 17:00', shiftHours: 5 },
      { orderId: 'ORD-7755', oldCommitDate: '2026-05-23', newCommitDate: '2026-05-26', shiftHours: 18 },
    ],
    overtimeHours: 6,
    weekendHours: 4,
    efficiencyLossPercent: 11,
    summary: 'Protect HelioTruck by moving the current job to Press 22 after a short changeover, then absorb MetroLift on Press 12 with Friday overtime. Apex Rail slips to Monday unless weekend coverage is approved.',
  }, plant);

  const optionPress22 = buildRerouteOption({
    id: 'press-22-only',
    name: 'Move all hot work to Press 22',
    machines: [available.find((item) => item.id === 'PRESS-22')],
    totalHours,
    protectedOrders: ['ORD-7718'],
    movedOrders: [
      { orderId: 'ORD-7740', oldCommitDate: '2026-05-22', newCommitDate: '2026-05-26', shiftHours: 20 },
      { orderId: 'ORD-7755', oldCommitDate: '2026-05-23', newCommitDate: '2026-05-27', shiftHours: 31 },
    ],
    overtimeHours: 9,
    weekendHours: 0,
    efficiencyLossPercent: 8,
    summary: 'Lowest changeover complexity, but Press 22 cannot absorb the whole week. It protects the critical launch order and pushes the next two accounts into next week.',
  }, plant);

  const optionWait = buildRerouteOption({
    id: 'wait-repair-weekend',
    name: 'Wait for repair, recover on weekend shift',
    machines: [machine],
    totalHours,
    protectedOrders: [],
    movedOrders: [
      { orderId: 'ORD-7718', oldCommitDate: '2026-05-21', newCommitDate: '2026-05-22', shiftHours: 14 },
      { orderId: 'ORD-7740', oldCommitDate: '2026-05-22', newCommitDate: '2026-05-26', shiftHours: 18 },
      { orderId: 'ORD-7755', oldCommitDate: '2026-05-23', newCommitDate: '2026-05-27', shiftHours: 34 },
    ],
    overtimeHours: 0,
    weekendHours: 12,
    efficiencyLossPercent: 0,
    summary: 'Operationally simple but commercially expensive. It lets the launch customer slip and creates three customer conversations instead of two.',
  }, plant);

  const options = [optionSplit, optionPress22, optionWait].sort((a, b) => b.score - a.score);
  return { totalHours, options };
}

function buildRerouteOption(input, plant) {
  const labor = plant.plant.labor;
  const changeoverHours = input.machines.reduce((sum, machine) => sum + Number(machine.changeoverHours ?? 0), 0);
  const overtimeCost = input.overtimeHours * labor.downstreamIdleRatePerHour * labor.overtimePremium;
  const weekendCost = input.weekendHours * labor.downstreamIdleRatePerHour * labor.weekendPremium;
  const changeoverCost = changeoverHours * labor.downstreamIdleRatePerHour * 0.65;
  const customerPenalty = input.movedOrders.reduce((sum, order) => sum + (order.shiftHours > 8 ? 4500 : 1200), 0);
  const costImpact = Math.round(overtimeCost + weekendCost + changeoverCost + customerPenalty);
  const score = 100
    - input.movedOrders.length * 16
    - input.movedOrders.reduce((sum, order) => sum + Math.min(24, order.shiftHours) * 0.6, 0)
    - input.efficiencyLossPercent * 0.8
    - costImpact / 2500
    + input.protectedOrders.length * 14;
  return {
    id: input.id,
    name: input.name,
    machines: input.machines.map((machine) => machine.id),
    summary: input.summary,
    protectedOrders: input.protectedOrders,
    movedOrders: input.movedOrders,
    overtimeHours: input.overtimeHours,
    weekendHours: input.weekendHours,
    efficiencyLossPercent: input.efficiencyLossPercent,
    costImpact,
    leadTimeImpactHours: Math.max(0, ...input.movedOrders.map((order) => order.shiftHours)),
    score: Math.round(score),
  };
}

function calculateClock(event) {
  const plant = event.plantState;
  const machine = plant.machines.find((item) => item.id === event.machineId);
  const currentJob = plant.jobs.find((job) => job.id === machine.currentJobId);
  const remainingUnits = currentJob.quantity - currentJob.completedQuantity;
  const throughputMarginPerMinute = (machine.nominalUnitsPerHour / 60) * currentJob.marginPerUnit;
  const downstreamIdleAtFullStarve = machine.downstreamStations
    .map((id) => plant.stations.find((station) => station.id === id).idleCostPerHour / 60)
    .reduce((sum, value) => sum + value, 0);
  const expeditingRiskPerMinute = plant.jobs
    .filter((job) => job.route.includes(machine.id))
    .reduce((sum, job) => sum + (job.marginPerUnit * Math.max(0, job.quantity - job.completedQuantity) * 0.06), 0) / (event.estimatedRepairHours * 60);
  const costPerMinute = throughputMarginPerMinute + downstreamIdleAtFullStarve + expeditingRiskPerMinute;
  return {
    detectedAt: event.detectedAt,
    costPerMinute,
    throughputMarginPerMinute,
    downstreamIdleAtFullStarve,
    expeditingRiskPerMinute,
    repairEstimateMinutes: event.estimatedRepairHours * 60,
    projectedCostAtRepair: costPerMinute * event.estimatedRepairHours * 60,
    currentJobMarginAtRisk: remainingUnits * currentJob.marginPerUnit,
    formula: 'current job margin/min + full downstream idle cost/min + expediting risk/min across affected orders',
  };
}

function buildNotifications(event, impact, recommendation) {
  const plant = event.plantState;
  return recommendation.movedOrders.map((move) => {
    const job = impact.affectedJobs.find((item) => item.orderId === move.orderId);
    const customer = plant.customers.find((item) => item.name === job.customer);
    const body = `Hi ${customer.contact},\n\nWe had an unplanned stoppage on ${event.machineName} this morning that touched ${job.part} on order ${job.orderId}. We have already rerouted the work under option "${recommendation.name}". Your previous commit date was ${move.oldCommitDate}; the updated commit date is ${move.newCommitDate}.\n\nThe short version: we are protecting the critical press work first, absorbing what we can on sister presses, and using overtime/weekend coverage where it prevents a larger slip. I wanted you to hear this from us now rather than discover it later in the week.\n\nIf the new date creates a downstream issue on your side, I can jump on a call today and walk through the options.\n\nCaleb`;
    return {
      orderId: job.orderId,
      jobId: job.id,
      customer: job.customer,
      to: `${customer.contact} <${customer.email}>`,
      subject: `Update on ${job.orderId}: ${job.part} commit date`,
      oldCommitDate: move.oldCommitDate,
      newCommitDate: move.newCommitDate,
      shiftHours: move.shiftHours,
      body,
    };
  });
}

async function executeComms(outDir, notifications, noSend) {
  const actionDir = path.join(outDir, 'customer-comms');
  await fs.mkdir(path.join(actionDir, 'messages'), { recursive: true });
  const receipts = [];
  for (const notification of notifications) {
    const command = noSend ? 'draft' : 'send';
    const receipt = await commsTool(command, actionDir, notification);
    receipts.push(receipt);
    await fs.writeFile(path.join(actionDir, 'messages', `${notification.orderId}.md`), renderNotification(notification, receipt));
  }
  return {
    sent: !noSend,
    receipts,
    actionDir,
  };
}

async function commsTool(command, outDir, payload) {
  const stdout = run(path.join(ROOT, 'tools/mock-customer-comms'), [command, outDir, JSON.stringify(payload)], { timeout: 30000 });
  return JSON.parse(stdout);
}

async function polishRecommendationWithFallback(config, event, impact, reroute, clock, fallback) {
  try {
    const prompt = await fs.readFile(path.join(ROOT, config.claws.rerouter), 'utf8');
    const response = await callOllama(config, [
      { role: 'system', content: `${prompt}\nReturn one concise operations recommendation paragraph only.` },
      { role: 'user', content: `/no_think\n${JSON.stringify({ event, impact, reroute, clock })}` },
    ]);
    return response.trim().split(/\n+/).join(' ').slice(0, 1000) || fallback;
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
      temperature: config.temperature ?? 0.3,
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

function estimateDelayHours(slot, detected, repairDone) {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  if (end <= detected) return 0;
  if (start >= repairDone) return 0;
  const overlapStart = new Date(Math.max(start.getTime(), detected.getTime()));
  const overlapEnd = new Date(Math.min(end.getTime(), repairDone.getTime()));
  return Math.max(0, overlapEnd - overlapStart) / (60 * 60 * 1000);
}

function renderEventMarkdown(event) {
  return `# Downtime Event\n\n- Event: ${event.eventId}\n- Machine: ${event.machineName} (${event.machineId})\n- Detected: ${formatDateTime(event.detectedAt)}\n- Repair estimate: ${event.estimatedRepairHours} hours\n- Source: ${event.source}\n- Symptoms: ${event.symptoms.join(', ')}\n`;
}

function renderImpactMarkdown(impact) {
  return `# Blast Radius\n\n${impact.summary}\n\n## Jobs\n\n${impact.affectedJobs.map((job) => `- **${job.jobId ?? job.id} / ${job.orderId}** ${job.customer} - ${job.part}\n  - Remaining units: ${job.remainingUnits.toLocaleString()}\n  - Margin at risk: $${Math.round(job.marginAtRisk).toLocaleString()}\n  - Without reroute delay: ${job.projectedSlipHoursWithoutReroute.toFixed(1)} hours`).join('\n')}\n\n## Downstream Starvation\n\n${impact.downstream.map((station) => `- **${station.name}** starves at ${formatDateTime(station.starvesAt)}; idle cost $${Math.round(station.idleCostPerMinute).toLocaleString()}/min`).join('\n')}\n\n## Customers\n\n${impact.customers.map((customer) => `- ${customer.name}: ${customer.contact} <${customer.email}>`).join('\n')}\n`;
}

function renderRerouteMarkdown(reroute, recommendation) {
  return `# Reroute Options\n\nRecommended: **${recommendation.name}**\n\n${recommendation.summary}\n\n${reroute.options.map((option, index) => `## ${index + 1}. ${option.name}\n\n- Score: ${option.score}\n- Machines: ${option.machines.join(', ')}\n- Cost impact: $${option.costImpact.toLocaleString()}\n- Lead-time impact: ${option.leadTimeImpactHours} hours\n- Overtime: ${option.overtimeHours} hours\n- Weekend: ${option.weekendHours} hours\n- Efficiency loss: ${option.efficiencyLossPercent}%\n- Protected orders: ${option.protectedOrders.join(', ') || 'none'}\n- Moved orders: ${option.movedOrders.map((order) => `${order.orderId} ${order.oldCommitDate} -> ${order.newCommitDate}`).join('; ') || 'none'}\n\n${option.summary}`).join('\n\n')}\n`;
}

function renderClockMarkdown(clock) {
  return `# Live Cost Clock\n\n- Cost rate: $${Math.round(clock.costPerMinute).toLocaleString()}/minute\n- Projected cost at repair estimate: $${Math.round(clock.projectedCostAtRepair).toLocaleString()}\n- Current job margin at risk: $${Math.round(clock.currentJobMarginAtRisk).toLocaleString()}\n- Formula: ${clock.formula}\n\nBreakdown:\n\n- Throughput margin: $${Math.round(clock.throughputMarginPerMinute).toLocaleString()}/min\n- Downstream idle at full starvation: $${Math.round(clock.downstreamIdleAtFullStarve).toLocaleString()}/min\n- Expediting risk: $${Math.round(clock.expeditingRiskPerMinute).toLocaleString()}/min\n`;
}

function renderNotificationsMarkdown(notifications, communication) {
  return `# Customer Notifications\n\nMode: ${communication.sent ? 'mock-safe sent receipts' : 'draft only'}\n\n${notifications.map((notification, index) => renderNotification(notification, communication.receipts[index])).join('\n\n')}\n`;
}

function renderNotification(notification, receipt = null) {
  return `## ${notification.customer} - ${notification.orderId}\n\nTo: ${notification.to}\nSubject: ${notification.subject}\nOld commit: ${notification.oldCommitDate}\nNew commit: ${notification.newCommitDate}${receipt ? `\nReceipt: ${receipt.id}` : ''}\n\n${notification.body}\n`;
}

function renderReportHtml(event, impact, reroute, clock, recommendation, notifications, communication) {
  const detectedMs = new Date(clock.detectedAt).getTime();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Cascade</title>
<style>
:root{--ink:#18212f;--muted:#657083;--line:#d8e0ea;--bg:#f4f6f9;--panel:#fff;--red:#b42318;--blue:#2457d6;--green:#147d4f;--amber:#a15c00}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 20px 56px}h1{font-size:38px;margin:0 0 8px;line-height:1.05}h2{font-size:22px;margin:0 0 12px}.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;margin:0 0 18px}.clock{font-size:48px;line-height:1;font-weight:850;color:var(--red);letter-spacing:0}.rate{font-size:18px;color:var(--muted)}.button{display:inline-block;background:var(--blue);color:white;text-decoration:none;border-radius:6px;padding:10px 14px;margin:0 8px 8px 0}.tag{display:inline-block;border-radius:999px;padding:3px 8px;background:#eef2f6;color:#334155;font-size:12px;font-weight:800}.ok{color:var(--green);font-weight:800}.warn{color:var(--amber);font-weight:800}.bad{color:var(--red);font-weight:800}li{margin:0 0 8px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid var(--line);padding:8px;vertical-align:top}a{color:var(--blue)}
@media(max-width:850px){.grid{grid-template-columns:1fr}.clock{font-size:36px}}
</style>
</head>
<body><main>
<h1>The Cascade</h1>
<section class="panel"><p><strong>${escapeHtml(event.machineName)}</strong> went down at ${escapeHtml(formatDateTime(event.detectedAt))}. Repair estimate: ${event.estimatedRepairHours} hours.</p><p><a class="button" href="blast-radius.md">Blast radius</a><a class="button" href="reroute-options.md">Reroute options</a><a class="button" href="customer-notifications.md">Customer notifications</a></p></section>
<section class="grid">
  <div class="panel"><h2>Live Cost Clock</h2><div class="clock" id="clock">$0</div><div class="rate">$${Math.round(clock.costPerMinute).toLocaleString()}/min calculated from schedule, margin, and idle downstream labor</div><p class="muted">Projected at repair estimate: $${Math.round(clock.projectedCostAtRepair).toLocaleString()}</p></div>
  <div class="panel"><h2>Recommendation</h2><p><span class="tag">Approved path</span></p><h3>${escapeHtml(recommendation.name)}</h3><p>${escapeHtml(recommendation.summary)}</p><p><strong>Cost impact:</strong> $${recommendation.costImpact.toLocaleString()} &nbsp; <strong>Lead-time max:</strong> ${recommendation.leadTimeImpactHours} hours</p></div>
</section>
<section class="grid">
  <div class="panel"><h2>Blast Radius</h2><ul>${impact.affectedJobs.map((job) => `<li><strong>${escapeHtml(job.orderId)}</strong> ${escapeHtml(job.customer)} - ${escapeHtml(job.part)}<br><span class="muted">${job.remainingUnits.toLocaleString()} units remaining; $${Math.round(job.marginAtRisk).toLocaleString()} margin at risk</span></li>`).join('')}</ul></div>
  <div class="panel"><h2>Downstream Starvation</h2><ul>${impact.downstream.map((station) => `<li><strong>${escapeHtml(station.name)}</strong> starves at ${escapeHtml(formatDateTime(station.starvesAt))}<br><span class="muted">$${Math.round(station.idleCostPerMinute).toLocaleString()}/min idle cost</span></li>`).join('')}</ul></div>
</section>
<section class="panel"><h2>Reroute Ranking</h2><table><thead><tr><th>Rank</th><th>Option</th><th>Score</th><th>Impact</th></tr></thead><tbody>${reroute.options.map((option, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(option.name)}<br><span class="muted">${escapeHtml(option.machines.join(', '))}</span></td><td>${option.score}</td><td>$${option.costImpact.toLocaleString()} cost; ${option.leadTimeImpactHours}h lead-time max</td></tr>`).join('')}</tbody></table></section>
<section class="panel"><h2>Customer Notifications ${communication.sent ? '<span class="ok">sent in demo mode</span>' : '<span class="warn">drafted</span>'}</h2>${notifications.map((notification) => `<h3>${escapeHtml(notification.customer)} - ${escapeHtml(notification.orderId)}</h3><p><strong>${escapeHtml(notification.subject)}</strong></p><p>${escapeHtml(notification.body).replaceAll('\n', '<br>')}</p>`).join('')}</section>
</main>
<script>
const detectedMs = ${JSON.stringify(detectedMs)};
const costPerMinute = ${JSON.stringify(clock.costPerMinute)};
function renderClock(){
  const elapsedMinutes = Math.max(0, (Date.now() - detectedMs) / 60000);
  const total = elapsedMinutes * costPerMinute;
  document.getElementById('clock').textContent = '$' + Math.round(total).toLocaleString();
}
renderClock();
setInterval(renderClock, 1000);
</script>
</body></html>`;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
    .slice(0, 80) || 'cascade';
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
