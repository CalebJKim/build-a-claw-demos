#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRuntimeConfig } from './demo-config.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
process.env.PATH = `${path.join(os.homedir(), '.npm-global', 'bin')}:${process.env.PATH ?? ''}`;

const DEFAULT_CONFIG = {
  model: 'qwen3.6:35b-a3b',
  ollamaHost: 'http://127.0.0.1:11434',
  temperature: 0.45,
  maxOutputTokens: 2048,
  gamePort: 19002,
  localGamePort: 19003,
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
    if (['help', 'skip-model', 'no-serve'].includes(key)) {
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
  self-fixing-game doctor
  self-fixing-game run --brief "Build me a multiplayer trivia game..."

Options:
  --skip-model        Use deterministic spec/copy instead of calling Ollama.
  --no-serve          Build and test artifacts without starting the live game server.
  --brief <text>      User's loose game request.
  --theme <text>      Theme override. Default inferred from the brief.
  --vibe <text>       Vibe override. Default inferred from the brief.
  --rounds <number>   Question count. Default from demo.config.json.
  --model <name>      Ollama model override.
  --out <path>        Output directory.
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
  const ollamaVersion = commandExists('ollama') ? safeRunLabel('ollama', ['--version']) : 'missing';
  const pythonPath = commandExists('python3') ?? 'missing';
  checks.push(['openclaw', openclawVersion]);
  checks.push(['ollama', ollamaVersion]);
  checks.push(['python3', pythonPath]);
  if (openclawVersion === 'missing' || ollamaVersion === 'missing' || pythonPath === 'missing') ok = false;
  if (openclawVersion.startsWith('error:') || ollamaVersion.startsWith('error:')) ok = false;

  let ollamaModels = [];
  try {
    const tags = await fetchJson(`${config.ollamaHost}/api/tags`, {}, 8000);
    ollamaModels = (tags.models ?? []).map((model) => model.name);
  } catch (error) {
    checks.push(['ollama-api', `error: ${error.message}`]);
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
  console.log(`game port: ${config.gamePort}`);
  if (!modelInstalled) ok = false;
  if (!ok) process.exitCode = 1;
}

async function runDemo(config, args) {
  const model = args.model ?? config.model;
  const effectiveConfig = { ...config, model };
  const profile = buildGameProfile(config, args);
  const spec = buildGameSpec(profile);
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'runs', `${timestamp()}-${slugify(spec.title)}`));
  const gameDir = path.join(outDir, 'game');
  await fs.mkdir(gameDir, { recursive: true });

  console.log(`Brief: ${profile.brief}`);
  console.log(`Game: ${spec.title}`);
  console.log(`Output: ${outDir}`);

  let notes = deterministicSpecNotes(profile, spec);
  if (!args['skip-model']) {
    notes = await polishSpecNotesWithFallback(effectiveConfig, profile, spec, notes);
  }

  await writeGameFiles(gameDir, spec, { buggy: true });
  const firstTest = await runSelfTests(gameDir, spec);
  const fixes = planFixes(firstTest);

  await writeGameFiles(gameDir, spec, { buggy: false });
  const finalTest = await runSelfTests(gameDir, spec);
  const smoke = await runServerSmokeTest(gameDir);
  const deployment = await startGameServerIfRequested(effectiveConfig, gameDir, args);

  const bugReport = {
    found: firstTest.results.filter((item) => item.status === 'fail'),
    fixes,
    verification: finalTest,
    smoke,
  };
  const analysis = {
    profile,
    spec,
    generatedAt: new Date().toISOString(),
    agents: ['spec', 'builder', 'tester', 'deployer'],
    notes,
    bugReport,
    deployment,
    artifacts: {
      game: 'game/',
      report: 'index.html',
      bugReport: 'bug-report.md',
      testLog: 'test-log.md',
      spec: 'spec.md',
    },
  };

  await fs.writeFile(path.join(outDir, 'brief.txt'), `${profile.brief}\n`);
  await fs.writeFile(path.join(outDir, 'spec.md'), renderSpecMarkdown(profile, spec, notes));
  await fs.writeFile(path.join(outDir, 'bug-report.md'), renderBugReport(bugReport));
  await fs.writeFile(path.join(outDir, 'test-log.md'), renderTestLog(firstTest, finalTest, smoke));
  await fs.writeFile(path.join(outDir, 'deploy.md'), renderDeployMarkdown(deployment, config));
  await writeJson(path.join(outDir, 'analysis.json'), analysis);
  await fs.writeFile(path.join(outDir, 'index.html'), renderReportHtml(profile, spec, notes, bugReport, deployment));

  console.log(`Initial bugs found: ${bugReport.found.length}`);
  console.log(`Final tests: ${finalTest.results.every((item) => item.status === 'pass') && smoke.status === 'pass' ? 'pass' : 'check report'}`);
  if (deployment.served) {
    console.log(`Game URL: ${deployment.serverLocalUrl}`);
    console.log(`Tunnel game URL: ${deployment.localTunnelUrl}`);
  } else {
    console.log('Game server: not started (--no-serve)');
  }
  console.log(`Bug report: ${path.join(outDir, 'bug-report.md')}`);
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
}

function buildGameProfile(config, args) {
  const sample = config.sample ?? {};
  const brief = args.brief ?? sample.brief ?? 'Build me a multiplayer trivia game my friends can play from their phones right now.';
  return {
    brief,
    theme: args.theme ?? sample.theme ?? inferLabel(brief, 'theme') ?? 'internet history',
    vibe: args.vibe ?? sample.vibe ?? inferLabel(brief, 'vibe') ?? 'neon arcade',
    rounds: Number(args.rounds ?? sample.rounds ?? 6),
  };
}

function inferLabel(brief, label) {
  const match = String(brief).match(new RegExp(`${label}\\s*:\\s*([^.;\\n]+)`, 'i'));
  return match?.[1]?.trim();
}

function buildGameSpec(profile) {
  const theme = profile.theme;
  const title = `${toTitleCase(theme)} Blitz`;
  const allQuestions = internetHistoryQuestions();
  return {
    title,
    theme,
    vibe: profile.vibe,
    tech: 'No-dependency Node HTTP server, Server-Sent Events for live state, vanilla mobile web client.',
    timerSeconds: 20,
    maxPlayers: 24,
    rounds: Math.min(Math.max(profile.rounds, 3), allQuestions.length),
    rules: [
      'Players join from the same phone-friendly URL.',
      'The first joined player is host and can start, advance, or reset.',
      'Each round has one multiple-choice trivia question.',
      'Correct answers score 100 points before the timer expires.',
      'Scores update live for every connected phone.',
    ],
    tests: [
      'Wrong answer must not score.',
      'Answers after the timer expires must be rejected.',
      'Mobile answer grid must collapse to one column.',
      'Generated server must respond to health, join, start, and answer requests.',
    ],
    questions: allQuestions.slice(0, Math.min(Math.max(profile.rounds, 3), allQuestions.length)),
  };
}

function internetHistoryQuestions() {
  return [
    {
      prompt: 'Which service popularized six-second looping videos before TikTok?',
      options: ['Vine', 'Flickr', 'Napster', 'GeoCities'],
      answer: 'Vine',
    },
    {
      prompt: 'What does HTTP stand for?',
      options: ['HyperText Transfer Protocol', 'Home Terminal Transfer Program', 'Hosted Text Thread Process', 'Hyperlink Timing Transport'],
      answer: 'HyperText Transfer Protocol',
    },
    {
      prompt: 'Which company built the original Netscape Navigator browser?',
      options: ['Netscape Communications', 'Sun Microsystems', 'Oracle', 'Atari'],
      answer: 'Netscape Communications',
    },
    {
      prompt: 'Which early web host became famous for neighborhood-style personal pages?',
      options: ['GeoCities', 'BitTorrent', 'Slack', 'Delicious'],
      answer: 'GeoCities',
    },
    {
      prompt: 'What was the name of Google before it became Google?',
      options: ['BackRub', 'PagePile', 'Searchly', 'CrawlerNet'],
      answer: 'BackRub',
    },
    {
      prompt: 'Which protocol is commonly used by browsers for real-time server push in this demo?',
      options: ['Server-Sent Events', 'SMTP', 'FTP', 'POP3'],
      answer: 'Server-Sent Events',
    },
  ];
}

function deterministicSpecNotes(profile, spec) {
  return `${spec.title} is scoped as a same-room multiplayer trivia game: one host, phones as controllers, timed rounds, live scores, and no npm install. The build uses Node HTTP endpoints for actions and Server-Sent Events for shared state so it can run on a Spark and be shared over a local network or SSH tunnel.`;
}

async function polishSpecNotesWithFallback(config, profile, spec, fallback) {
  try {
    const prompt = await fs.readFile(path.join(ROOT, config.claws.spec), 'utf8');
    const response = await callOllama(config, [
      { role: 'system', content: `${prompt}\nReturn one concise paragraph. Do not add cloud services or npm dependencies.` },
      { role: 'user', content: `/no_think\n${JSON.stringify({ profile, spec })}` },
    ]);
    return response.trim().split(/\n+/).join(' ').slice(0, 900) || fallback;
  } catch {
    return fallback;
  }
}

async function writeGameFiles(gameDir, spec, options) {
  const publicDir = path.join(gameDir, 'public');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(gameDir, 'package.json'), renderGamePackage(spec));
  await fs.writeFile(path.join(gameDir, 'game-core.mjs'), renderGameCore(spec, options));
  await fs.writeFile(path.join(gameDir, 'server.js'), renderGameServer(spec));
  await fs.writeFile(path.join(publicDir, 'index.html'), renderGameIndex(spec));
  await fs.writeFile(path.join(publicDir, 'styles.css'), renderGameStyles(spec, options));
  await fs.writeFile(path.join(publicDir, 'client.js'), renderGameClient(spec));
}

function renderGamePackage(spec) {
  return `${JSON.stringify({
    name: slugify(spec.title),
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      start: 'node server.js',
    },
  }, null, 2)}\n`;
}

function renderGameCore(spec, options) {
  const answerCheck = options.buggy
    ? 'return correctNorm.includes(answerNorm);'
    : 'return answerNorm === correctNorm;';
  const canAnswer = options.buggy
    ? "return state.phase === 'question';"
    : "return state.phase === 'question' && timeLeftMs(state, now) > 0;";

  return `export const GAME_TITLE = ${JSON.stringify(spec.title)};
export const ROUND_MS = ${spec.timerSeconds * 1000};
export const QUESTIONS = ${JSON.stringify(spec.questions, null, 2)};

export function createState() {
  return {
    title: GAME_TITLE,
    phase: 'lobby',
    hostId: null,
    players: {},
    currentIndex: 0,
    startedAt: 0,
    answers: {},
    events: ['Room created. Waiting for players.'],
  };
}

export function joinPlayer(state, name) {
  const cleanName = String(name || '').trim().slice(0, 32) || 'Player';
  const id = 'p_' + Math.random().toString(36).slice(2, 10);
  state.players[id] = { id, name: cleanName, score: 0, answered: false };
  if (!state.hostId) state.hostId = id;
  logEvent(state, cleanName + ' joined the room.');
  return state.players[id];
}

export function startGame(state, now = Date.now()) {
  state.phase = 'question';
  state.currentIndex = 0;
  state.startedAt = now;
  state.answers = {};
  for (const player of Object.values(state.players)) player.answered = false;
  logEvent(state, 'Game started.');
  return snapshot(state, now);
}

export function nextQuestion(state, now = Date.now()) {
  if (state.currentIndex >= QUESTIONS.length - 1) {
    state.phase = 'finished';
    logEvent(state, 'Game finished.');
    return snapshot(state, now);
  }
  state.currentIndex += 1;
  state.phase = 'question';
  state.startedAt = now;
  state.answers = {};
  for (const player of Object.values(state.players)) player.answered = false;
  logEvent(state, 'Question ' + (state.currentIndex + 1) + ' started.');
  return snapshot(state, now);
}

export function resetGame(state) {
  state.phase = 'lobby';
  state.currentIndex = 0;
  state.startedAt = 0;
  state.answers = {};
  for (const player of Object.values(state.players)) {
    player.score = 0;
    player.answered = false;
  }
  logEvent(state, 'Game reset.');
  return snapshot(state);
}

export function currentQuestion(state) {
  return QUESTIONS[state.currentIndex];
}

export function timeLeftMs(state, now = Date.now()) {
  if (state.phase !== 'question') return 0;
  return Math.max(0, ROUND_MS - (now - state.startedAt));
}

export function canAnswer(state, now = Date.now()) {
  ${canAnswer}
}

export function isAnswerCorrect(answer, correct) {
  const answerNorm = normalizeAnswer(answer);
  const correctNorm = normalizeAnswer(correct);
  if (!answerNorm) return false;
  ${answerCheck}
}

export function submitAnswer(state, playerId, answer, now = Date.now()) {
  const player = state.players[playerId];
  if (!player) return { accepted: false, reason: 'unknown-player' };
  if (!canAnswer(state, now)) return { accepted: false, reason: 'timer-expired' };
  if (player.answered) return { accepted: false, reason: 'already-answered' };

  const question = currentQuestion(state);
  const correct = isAnswerCorrect(answer, question.answer);
  player.answered = true;
  if (correct) player.score += 100;
  state.answers[playerId] = { answer, correct };
  logEvent(state, player.name + ' answered ' + (correct ? 'correctly.' : 'incorrectly.'));

  const players = Object.values(state.players);
  if (players.length > 0 && players.every((item) => item.answered)) {
    state.phase = 'reveal';
    logEvent(state, 'All players answered. Reveal time.');
  }
  return { accepted: true, correct, score: player.score };
}

export function snapshot(state, now = Date.now()) {
  const question = currentQuestion(state);
  return {
    title: state.title,
    phase: state.phase,
    hostId: state.hostId,
    currentIndex: state.currentIndex,
    totalQuestions: QUESTIONS.length,
    timerLeftMs: timeLeftMs(state, now),
    players: Object.values(state.players).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    question: state.phase === 'question' || state.phase === 'reveal'
      ? { prompt: question.prompt, options: question.options, answer: state.phase === 'reveal' ? question.answer : null }
      : null,
    events: state.events.slice(0, 8),
  };
}

function normalizeAnswer(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function logEvent(state, message) {
  state.events.unshift(message);
  state.events = state.events.slice(0, 20);
}
`;
}

function renderGameServer() {
  return `import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, joinPlayer, startGame, nextQuestion, resetGame, submitAnswer, snapshot } from './game-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 19002);
const HOST = process.env.HOST || '127.0.0.1';
const state = createState();
const clients = new Set();

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, title: state.title });
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, snapshot(state));
    if (req.method === 'GET' && url.pathname === '/events') return events(req, res);
    if (req.method === 'POST' && url.pathname === '/api/join') {
      const body = await readJson(req);
      const player = joinPlayer(state, body.name);
      broadcast();
      return json(res, 200, { player, state: snapshot(state) });
    }
    if (req.method === 'POST' && url.pathname === '/api/start') {
      startGame(state);
      broadcast();
      return json(res, 200, snapshot(state));
    }
    if (req.method === 'POST' && url.pathname === '/api/answer') {
      const body = await readJson(req);
      const result = submitAnswer(state, body.playerId, body.answer);
      broadcast();
      return json(res, 200, { result, state: snapshot(state) });
    }
    if (req.method === 'POST' && url.pathname === '/api/next') {
      nextQuestion(state);
      broadcast();
      return json(res, 200, snapshot(state));
    }
    if (req.method === 'POST' && url.pathname === '/api/reset') {
      resetGame(state);
      broadcast();
      return json(res, 200, snapshot(state));
    }
    if (req.method === 'GET') return staticFile(url.pathname, res);
    json(res, 404, { error: 'not-found' });
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log('Game server listening on http://' + HOST + ':' + PORT);
});

function events(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const client = { res };
  clients.add(client);
  sendEvent(client);
  req.on('close', () => clients.delete(client));
}

function broadcast() {
  for (const client of clients) sendEvent(client);
}

function sendEvent(client) {
  client.res.write('event: state\\n');
  client.res.write('data: ' + JSON.stringify(snapshot(state)) + '\\n\\n');
}

async function staticFile(requestPath, res) {
  const clean = requestPath === '/' ? 'index.html' : requestPath.replace(/^\\/+/, '');
  const relative = clean.startsWith('public/') ? clean.slice('public/'.length) : clean;
  const filePath = path.resolve(PUBLIC, relative);
  if (!filePath.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });
  const data = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
  res.end(data);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
`;
}

function renderGameIndex(spec) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(spec.title)}</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<main class="shell">
  <header class="topbar">
    <div>
      <p class="eyebrow">${escapeHtml(spec.vibe)}</p>
      <h1>${escapeHtml(spec.title)}</h1>
    </div>
    <div class="pill" id="phase">Lobby</div>
  </header>

  <section class="join" id="join">
    <h2>Join the room</h2>
    <form id="join-form">
      <input id="name" autocomplete="name" placeholder="Your name" maxlength="32" required>
      <button type="submit">Join</button>
    </form>
  </section>

  <section class="board" id="board" hidden>
    <div class="question-card">
      <div class="meta">
        <span id="round">Round 1</span>
        <span id="timer">20s</span>
      </div>
      <h2 id="question">Waiting for host...</h2>
      <div class="answers" id="answers"></div>
      <p class="result" id="result"></p>
    </div>

    <aside class="side">
      <div class="controls" id="host-controls" hidden>
        <button id="start">Start</button>
        <button id="next">Next</button>
        <button id="reset">Reset</button>
      </div>
      <h2>Scoreboard</h2>
      <ol id="players"></ol>
      <h2>Live Log</h2>
      <ul id="events"></ul>
    </aside>
  </section>
</main>
<script type="module" src="/client.js"></script>
</body>
</html>`;
}

function renderGameClient() {
  return `let state = null;
let playerId = localStorage.getItem('selfFixingGamePlayerId') || '';

const joinSection = document.getElementById('join');
const board = document.getElementById('board');
const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name');
const phase = document.getElementById('phase');
const round = document.getElementById('round');
const timer = document.getElementById('timer');
const question = document.getElementById('question');
const answers = document.getElementById('answers');
const result = document.getElementById('result');
const players = document.getElementById('players');
const events = document.getElementById('events');
const hostControls = document.getElementById('host-controls');

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await post('/api/join', { name: nameInput.value });
  playerId = response.player.id;
  localStorage.setItem('selfFixingGamePlayerId', playerId);
  state = response.state;
  render();
});

document.getElementById('start').addEventListener('click', () => post('/api/start', {}));
document.getElementById('next').addEventListener('click', () => post('/api/next', {}));
document.getElementById('reset').addEventListener('click', () => post('/api/reset', {}));

const source = new EventSource('/events');
source.addEventListener('state', (event) => {
  state = JSON.parse(event.data);
  render();
});

setInterval(() => {
  if (state && state.phase === 'question') {
    state.timerLeftMs = Math.max(0, state.timerLeftMs - 1000);
    renderTimer();
  }
}, 1000);

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

function render() {
  if (!state) return;
  const joined = state.players.some((player) => player.id === playerId);
  joinSection.hidden = joined;
  board.hidden = !joined;
  phase.textContent = state.phase;
  hostControls.hidden = state.hostId !== playerId;
  round.textContent = 'Round ' + Math.min(state.currentIndex + 1, state.totalQuestions) + ' / ' + state.totalQuestions;
  renderTimer();

  players.innerHTML = state.players.map((player) => '<li><span>' + escapeHtml(player.name) + '</span><strong>' + player.score + '</strong></li>').join('');
  events.innerHTML = state.events.map((item) => '<li>' + escapeHtml(item) + '</li>').join('');

  if (!state.question) {
    question.textContent = state.phase === 'finished' ? 'Final scores are in.' : 'Waiting for the host to start.';
    answers.innerHTML = '';
    result.textContent = state.phase === 'finished' ? 'Reset the room to play again.' : 'The first person to join is host.';
    return;
  }

  question.textContent = state.question.prompt;
  const me = state.players.find((player) => player.id === playerId);
  answers.innerHTML = state.question.options.map((option) => '<button class="answer" ' + (state.phase !== 'question' || me?.answered ? 'disabled' : '') + ' data-answer="' + escapeHtml(option) + '">' + escapeHtml(option) + '</button>').join('');
  for (const button of answers.querySelectorAll('button')) {
    button.addEventListener('click', async () => {
      const response = await post('/api/answer', { playerId, answer: button.dataset.answer });
      result.textContent = response.result.correct ? 'Correct. +100' : response.result.reason || 'Not this one.';
    });
  }
  result.textContent = state.phase === 'reveal' ? 'Answer: ' + state.question.answer : (me?.answered ? 'Answer locked.' : '');
}

function renderTimer() {
  if (!state) return;
  timer.textContent = Math.ceil((state.timerLeftMs || 0) / 1000) + 's';
  timer.classList.toggle('danger', state.phase === 'question' && state.timerLeftMs <= 5000);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
`;
}

function renderGameStyles(spec, options) {
  const mobileFix = options.buggy ? '' : `
@media (max-width:700px){
  .shell{padding:14px}
  .topbar,.board{grid-template-columns:1fr}
  h1{font-size:32px}
  .answers{grid-template-columns:1fr}
  .controls{grid-template-columns:1fr}
}
`;
  return `:root{--bg:#111827;--panel:#172033;--panel2:#202b45;--ink:#f7fbff;--muted:#aab7cf;--cyan:#55d7ff;--pink:#ff4ecd;--green:#9cff6e;--line:#34415f}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 10%,#263a73 0,#111827 32%,#0d1220 100%);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}
button,input{font:inherit}.shell{max-width:1120px;margin:0 auto;padding:24px}.topbar{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:center;margin-bottom:18px}
.eyebrow{text-transform:uppercase;color:var(--cyan);font-weight:800;font-size:12px;letter-spacing:0;margin:0 0 4px}h1{font-size:44px;line-height:1;margin:0;text-shadow:0 0 26px rgba(85,215,255,.35)}h2{margin:0 0 14px}.pill{border:1px solid var(--cyan);color:var(--cyan);border-radius:999px;padding:8px 12px;text-transform:uppercase;font-size:12px;font-weight:800}
.join,.question-card,.side{background:rgba(23,32,51,.94);border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 80px rgba(0,0,0,.28);padding:18px}.join{max-width:520px}.join form{display:grid;grid-template-columns:1fr auto;gap:10px}.join input{border:1px solid var(--line);border-radius:6px;background:#0f172a;color:var(--ink);padding:12px}
button{border:0;border-radius:6px;background:linear-gradient(135deg,var(--cyan),var(--pink));color:#08111f;font-weight:850;padding:12px 14px;cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed;filter:grayscale(.4)}
.board{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,.7fr);gap:18px}.meta{display:flex;justify-content:space-between;color:var(--muted);font-weight:800;margin-bottom:16px}.danger{color:var(--pink)}#question{font-size:28px;line-height:1.15}.answers{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:12px}.answer{background:var(--panel2);color:var(--ink);border:1px solid var(--line);text-align:left;min-height:64px}.answer:hover{border-color:var(--cyan);box-shadow:0 0 0 1px var(--cyan)}
.result{min-height:24px;color:var(--green);font-weight:800}.controls{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}ol,ul{padding-left:20px;margin:0 0 18px}li{margin-bottom:8px}ol li{display:flex;justify-content:space-between;gap:12px}strong{color:var(--green)}
${mobileFix}`;
}

async function runSelfTests(gameDir, spec) {
  const coreUrl = `${pathToFileURL(path.join(gameDir, 'game-core.mjs')).href}?v=${Date.now()}${Math.random()}`;
  const core = await import(coreUrl);
  const css = readFileSync(path.join(gameDir, 'public', 'styles.css'), 'utf8');
  const results = [];

  {
    const state = core.createState();
    const player = core.joinPlayer(state, 'Wrong Answer Tester');
    core.startGame(state, 0);
    const correct = core.QUESTIONS[0].answer;
    const partial = correct.slice(0, Math.max(1, correct.length - 1));
    const result = core.submitAnswer(state, player.id, partial, 1000);
    results.push({
      id: 'wrong-answer-rejected',
      title: 'Wrong or partial answer must not be accepted',
      status: result.correct ? 'fail' : 'pass',
      observed: `Submitted "${partial}" for "${correct}". Accepted=${result.accepted}, correct=${Boolean(result.correct)}.`,
      fix: 'Use exact normalized answer matching instead of substring matching.',
    });
  }

  {
    const state = core.createState();
    const player = core.joinPlayer(state, 'Timer Tester');
    core.startGame(state, 0);
    const correct = core.QUESTIONS[0].answer;
    const result = core.submitAnswer(state, player.id, correct, core.ROUND_MS + 1000);
    results.push({
      id: 'timer-expiry-enforced',
      title: 'Answer after timer expiry must be rejected',
      status: result.accepted ? 'fail' : 'pass',
      observed: `Submitted correct answer after ${core.ROUND_MS + 1000}ms. Accepted=${result.accepted}, reason=${result.reason ?? 'none'}.`,
      fix: 'Gate answer submission on remaining round time.',
    });
  }

  {
    const mobileOk = /@media\s*\(max-width:\s*700px\)[\s\S]*\.answers\s*\{[\s\S]*grid-template-columns:\s*1fr/.test(css);
    results.push({
      id: 'mobile-answer-grid',
      title: 'Mobile answer grid must collapse to one column',
      status: mobileOk ? 'pass' : 'fail',
      observed: mobileOk ? 'Mobile media query found.' : 'No mobile one-column answer grid found.',
      fix: 'Add a max-width media query that makes answer buttons one column.',
    });
  }

  {
    const required = ['server.js', 'game-core.mjs', 'public/index.html', 'public/client.js', 'public/styles.css'];
    const missing = required.filter((file) => !existsSync(path.join(gameDir, file)));
    results.push({
      id: 'required-files-present',
      title: 'Generated game files must exist',
      status: missing.length ? 'fail' : 'pass',
      observed: missing.length ? `Missing: ${missing.join(', ')}` : `All ${required.length} required files present.`,
      fix: 'Regenerate the missing server/client files.',
    });
  }

  return {
    title: spec.title,
    status: results.every((item) => item.status === 'pass') ? 'pass' : 'fail',
    results,
  };
}

function planFixes(testRun) {
  return testRun.results
    .filter((item) => item.status === 'fail')
    .map((item) => ({
      id: item.id,
      fix: item.fix,
      applied: true,
    }));
}

async function runServerSmokeTest(gameDir) {
  const port = 23000 + Math.floor(Math.random() * 10000);
  const logFile = path.join(gameDir, 'self-test-server.log');
  const fd = openSync(logFile, 'a');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: gameDir,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', fd, fd],
  });

  try {
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, 8000);
    const index = await fetchText(`http://127.0.0.1:${port}/`);
    const join = await postJson(`http://127.0.0.1:${port}/api/join`, { name: 'Smoke Tester' });
    await postJson(`http://127.0.0.1:${port}/api/start`, {});
    const answer = join.state.question?.options?.[0] ?? 'Vine';
    const submitted = await postJson(`http://127.0.0.1:${port}/api/answer`, { playerId: join.player.id, answer });
    return {
      status: index.includes('<main') && submitted.result?.accepted ? 'pass' : 'fail',
      observed: `Health ok, index bytes=${index.length}, join player=${join.player.name}, answer accepted=${Boolean(submitted.result?.accepted)}.`,
    };
  } catch (error) {
    return {
      status: 'fail',
      observed: error.message,
    };
  } finally {
    child.kill('SIGTERM');
    closeSync(fd);
  }
}

async function startGameServerIfRequested(config, gameDir, args) {
  if (args['no-serve']) {
    return {
      served: false,
      reason: '--no-serve',
      serverLocalUrl: null,
      localTunnelUrl: null,
    };
  }

  const port = Number(config.gamePort);
  const localPort = Number(config.localGamePort ?? config.gamePort);
  const generatedDir = path.join(ROOT, '.generated');
  await fs.mkdir(generatedDir, { recursive: true });
  await killPidFile(path.join(generatedDir, 'game-server.pid'));

  const logFile = path.join(generatedDir, 'game-server.log');
  const fd = openSync(logFile, 'a');
  const child = spawn(process.execPath, [path.join(gameDir, 'server.js')], {
    cwd: gameDir,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  closeSync(fd);

  await fs.writeFile(path.join(generatedDir, 'game-server.pid'), `${child.pid}\n`);
  await fs.writeFile(path.join(generatedDir, 'game-server-run'), `${gameDir}\n`);
  await waitForHealth(`http://127.0.0.1:${port}/api/health`, 10000);

  return {
    served: true,
    pid: child.pid,
    port,
    localTunnelPort: localPort,
    serverLocalUrl: `http://127.0.0.1:${port}/`,
    localTunnelUrl: `http://127.0.0.1:${localPort}/`,
    logFile,
  };
}

async function killPidFile(pidFile) {
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (pid > 0) {
    try {
      process.kill(pid, 'SIGTERM');
      await delay(250);
    } catch {
      // Process is already gone.
    }
  }
  await fs.rm(pidFile, { force: true });
}

async function waitForHealth(url, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function callOllama(config, messages) {
  const response = await fetchJson(`${config.ollamaHost}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      options: {
        temperature: config.temperature ?? 0.45,
        num_predict: config.maxOutputTokens ?? 2048,
      },
    }),
  }, 180000);
  return response.message?.content ?? '';
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

function renderSpecMarkdown(profile, spec, notes) {
  return `# Game Spec\n\nBrief: ${profile.brief}\n\n## ${spec.title}\n\n${notes}\n\n## Tech Approach\n\n${spec.tech}\n\n## Rules\n\n${spec.rules.map((item) => `- ${item}`).join('\n')}\n\n## Test Targets\n\n${spec.tests.map((item) => `- ${item}`).join('\n')}\n\n## Questions\n\n${spec.questions.map((item, index) => `${index + 1}. ${item.prompt}\n   - Answer: ${item.answer}`).join('\n')}\n`;
}

function renderBugReport(report) {
  const found = report.found.length
    ? report.found.map((item) => `## Found: ${item.title}\n\n- Test: \`${item.id}\`\n- Observed: ${item.observed}\n- Fix: ${item.fix}\n- Status after fix: ${report.verification.results.find((next) => next.id === item.id)?.status ?? 'unknown'}\n`).join('\n')
    : 'No initial bugs found.\n';
  return `# Self-Fixing Bug Report\n\nThe tester claw ran the first generated build, found ${report.found.length} issues, handed them back to the builder claw, and verified the repaired build.\n\n${found}\n## Server Smoke Test\n\n- Status: ${report.smoke.status}\n- Observed: ${report.smoke.observed}\n\n## Final Verification\n\n${report.verification.results.map((item) => `- ${item.status === 'pass' ? 'PASS' : 'FAIL'}: ${item.title} (${item.id})`).join('\n')}\n`;
}

function renderTestLog(firstTest, finalTest, smoke) {
  return `# Test Log\n\n## First Build\n\n${firstTest.results.map((item) => `- ${item.status.toUpperCase()} ${item.id}: ${item.observed}`).join('\n')}\n\n## Fixed Build\n\n${finalTest.results.map((item) => `- ${item.status.toUpperCase()} ${item.id}: ${item.observed}`).join('\n')}\n\n## Server Smoke\n\n- ${smoke.status.toUpperCase()}: ${smoke.observed}\n`;
}

function renderDeployMarkdown(deployment, config) {
  if (!deployment.served) {
    return `# Deployment\n\nGame server was not started because \`${deployment.reason}\` was provided.\n\nTo serve manually:\n\n\`\`\`bash\ncd game\nPORT=${config.gamePort} node server.js\n\`\`\`\n`;
  }
  return `# Deployment\n\nGame server started.\n\n- Server-local URL: ${deployment.serverLocalUrl}\n- Laptop tunnel URL: ${deployment.localTunnelUrl}\n- PID: ${deployment.pid}\n- Log: ${deployment.logFile}\n\nRemote tunnel example:\n\n\`\`\`bash\nssh -L ${config.localGamePort}:127.0.0.1:${config.gamePort} <user>@<device>\n\`\`\`\n`;
}

function renderReportHtml(profile, spec, notes, bugReport, deployment) {
  const gameLink = deployment.served
    ? `<a class="button" href="${escapeHtml(deployment.localTunnelUrl)}">Open game via tunnel</a><a class="button secondary" href="${escapeHtml(deployment.serverLocalUrl)}">Open server-local game</a>`
    : '<span class="muted">Game server was not started in this run.</span>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Self-Fixing Game Report</title>
<style>
:root{--ink:#172033;--muted:#647084;--line:#d9e0ea;--bg:#f5f7fb;--panel:#fff;--blue:#1f6feb;--green:#147d4f;--red:#b42318}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1120px;margin:0 auto;padding:34px 20px 56px}h1{font-size:34px;line-height:1.1;margin:0 0 8px}h2{font-size:22px;margin:0 0 12px}.muted{color:var(--muted)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;margin:0 0 18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.button{display:inline-block;background:var(--blue);color:white;text-decoration:none;border-radius:6px;padding:10px 14px;margin:0 8px 8px 0}.secondary{background:#334155}.pass{color:var(--green);font-weight:800}.fail{color:var(--red);font-weight:800}li{margin:0 0 8px}code{background:#eef2f6;padding:2px 5px;border-radius:5px}
@media(max-width:800px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body><main>
<h1>Self-Fixing Game Report</h1>
<section class="panel"><p><strong>Brief:</strong> ${escapeHtml(profile.brief)}</p><p class="muted">${escapeHtml(spec.title)} &middot; ${escapeHtml(spec.vibe)}</p><p>${gameLink}<a class="button secondary" href="bug-report.md">Open bug report</a></p></section>
<section class="grid">
  <div class="panel"><h2>Game Spec</h2><p>${escapeHtml(notes)}</p><ul>${spec.rules.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
  <div class="panel"><h2>Self-Test Loop</h2><p>Initial bugs found: <strong>${bugReport.found.length}</strong></p><ul>${bugReport.found.map((item) => `<li><span class="fail">FIXED</span> ${escapeHtml(item.title)}</li>`).join('')}</ul><p>Server smoke: <span class="${bugReport.smoke.status === 'pass' ? 'pass' : 'fail'}">${escapeHtml(bugReport.smoke.status)}</span></p></div>
</section>
<section class="panel"><h2>Generated Artifacts</h2><ul><li><a href="spec.md">Spec</a></li><li><a href="bug-report.md">Bug report</a></li><li><a href="test-log.md">Test log</a></li><li><a href="deploy.md">Deploy notes</a></li><li><a href="analysis.json">Analysis JSON</a></li></ul></section>
</main></body></html>`;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
    .slice(0, 80) || 'game';
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function toTitleCase(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
