#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from './demo-config.js';

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
    if (['help'].includes(key)) {
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
  one-ask-twenty-steps doctor
  one-ask-twenty-steps sample [--out runs/demo]
  one-ask-twenty-steps run --ask "Put together a reading list on personal finance for a beginner." [--out runs/demo]
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
    cwd: ROOT,
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
  const ask = args.ask ?? args.prompt ?? (args._.join(' ') || config.sample?.ask);
  if (!ask) throw new Error('Missing --ask');
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'runs', `${timestamp()}-one-ask`));
  await fs.mkdir(outDir, { recursive: true });

  const stdout = run(process.execPath, ['scripts/demo-runner.mjs', '--out-dir', outDir, ask]);
  const sourceHtml = path.join(outDir, 'beginner-personal-finance-reading-list.html');
  const sourceMarkdown = path.join(outDir, 'beginner-personal-finance-reading-list.md');
  await fs.writeFile(path.join(outDir, 'runner-output.txt'), stdout);
  await fs.copyFile(sourceHtml, path.join(outDir, 'index.html'));
  await fs.copyFile(sourceMarkdown, path.join(outDir, 'reading-list.md'));

  console.log(`Ask: ${ask}`);
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
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
    const args = parseArgs(rest);
    await runDemo(config, { ...args, ask: args.ask ?? config.sample?.ask });
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
