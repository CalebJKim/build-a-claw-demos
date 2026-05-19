#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from './demo-config.js';
import { collectBriefing, loadConfig, renderDigest, sendTelegram, writeBriefingOutputs } from './briefing-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
process.env.PATH = `${path.join(os.homedir(), '.npm-global', 'bin')}:${process.env.PATH ?? ''}`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    if (['help', 'demo', 'live', 'send', 'dry-run', 'json'].includes(key)) {
      args[key] = true;
      continue;
    }
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

function usage() {
  return `Usage:
  morning-briefing doctor
  morning-briefing sample [--out runs/demo]
  morning-briefing run [--demo|--live] [--send] [--now ISO] [--out runs/demo]
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
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} exited ${result.status}`).trim());
  return result.stdout;
}

function tryRun(command, args) {
  try {
    return run(command, args).trim();
  } catch (error) {
    return `error: ${String(error.message).split('\n')[0]}`;
  }
}

async function doctor(config) {
  const checks = [];
  checks.push(['node', process.version]);
  checks.push(['openclaw', commandExists('openclaw') ? tryRun('openclaw', ['--version']) : 'missing']);
  checks.push(['ollama', commandExists('ollama') ? tryRun('ollama', ['--version']) : 'missing']);
  checks.push(['python3', commandExists('python3') ?? 'missing']);

  let ollamaModels = [];
  try {
    const tags = await fetchJson(`${config.ollamaHost}/api/tags`, {}, 8000);
    ollamaModels = (tags.models ?? []).map((model) => model.name);
  } catch (error) {
    checks.push(['ollama-api', `error: ${error.message}`]);
  }

  for (const [name, value] of checks) console.log(`${name}: ${value}`);
  console.log(`configured model: ${config.model}`);
  console.log(`model installed: ${ollamaModels.includes(config.model) ? 'yes' : 'no'}`);
}

async function runDemo(config, args) {
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'runs', `${timestamp()}-morning-briefing`));
  const briefingConfig = await loadConfig(args.config ?? 'config/briefing.json');
  const demo = args.live ? false : true;
  const now = args.now ?? config.sample?.now;
  const timeoutMs = Number(args['timeout-ms'] ?? 8000);
  const briefing = await collectBriefing(briefingConfig, { demo, timeoutMs, now });
  const digest = renderDigest(briefing, briefingConfig);

  await fs.mkdir(outDir, { recursive: true });
  await writeBriefingOutputs(briefing, digest, outDir);
  await fs.writeFile(path.join(outDir, 'index.html'), renderHtml(briefing.title, digest));

  if (args.send) {
    await sendTelegram(digest, briefingConfig);
    await fs.writeFile(path.join(outDir, 'delivery-receipt.txt'), 'Sent Telegram briefing.\n');
  }

  console.log(`Mode: ${demo ? 'fixture demo' : 'live with fixture fallback'}`);
  console.log(`Generated: ${briefing.generatedAt}`);
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
}

function renderHtml(title, digest) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{margin:0;background:#f5f7fb;color:#1f2328;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:860px;margin:0 auto;padding:40px 24px;background:#fff;min-height:100vh}h1{font-size:30px;margin:0 0 20px}pre{white-space:pre-wrap;background:#f0f4f8;border:1px solid #d8e0ea;border-radius:8px;padding:18px;overflow:auto}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(digest)}</pre></main></body></html>
`;
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const [command = 'run', ...rest] = process.argv.slice(2);
  const config = loadRuntimeConfig(ROOT, {});
  if (command === 'doctor') {
    await doctor(config);
    return;
  }
  if (command === 'sample') {
    await runDemo(config, parseArgs(['--demo', ...rest]));
    return;
  }
  if (command === 'run') {
    await runDemo(config, parseArgs(rest));
    return;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(usage());
    return;
  }
  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
