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
  temperature: 0.25,
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
  meeting-aftermath doctor
  meeting-aftermath run --transcript /path/to/transcript.txt [--pm-format linear]
  meeting-aftermath run --mock-transcript product-sync [--pm-format linear]

Options:
  --skip-model          Use deterministic summary text instead of calling Ollama.
  --model <name>        Model id override. Default from demo.config.json.
  --organization <name> Organization/context label for outputs.
  --pm-format <format>  linear, jira, asana, or markdown. Default from demo.config.json.
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
  checks.push(['mock-transcript-api', existsSync(path.join(ROOT, 'tools/mock-transcript-api')) ? 'present' : 'missing']);
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

async function runDemo(config, args) {
  const model = args.model ?? config.model;
  const effectiveConfig = { ...config, model };
  const pmFormat = (args['pm-format'] ?? config.sample?.pmFormat ?? 'linear').toLowerCase();
  const organization = args.organization ?? config.sample?.organization ?? 'Team';
  const input = await loadTranscriptInput(args, config);
  const title = input.title || 'Meeting Transcript';
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'runs', `${timestamp()}-${slugify(title)}`));
  await fs.mkdir(path.join(outDir, 'draft-emails'), { recursive: true });

  console.log(`Meeting: ${title}`);
  console.log(`Organization: ${organization}`);
  console.log(`PM format: ${pmFormat}`);
  console.log(`Output: ${outDir}`);

  const turns = parseTranscript(input.transcript);
  const participants = input.participants?.length ? input.participants : inferParticipants(turns);

  const [meetingFacts, ownerMap, timelineSeed] = await Promise.all([
    Promise.resolve(extractMeetingFacts(turns)),
    Promise.resolve(extractActionItems(turns, participants)),
    Promise.resolve(buildTimelineSeed(turns)),
  ]);

  const emails = draftEmails(ownerMap.actionItems, participants, title, organization);
  const timeline = buildTimeline(ownerMap.actionItems, meetingFacts.blockers, pmFormat);
  const summaryText = args['skip-model']
    ? deterministicSummary(title, meetingFacts, ownerMap, timeline)
    : await summarizeWithFallback(effectiveConfig, title, meetingFacts, ownerMap, timeline);
  const analysis = {
    title,
    organization,
    source: input.source,
    recordedAt: input.recordedAt,
    participantCount: participants.length,
    turnCount: turns.length,
    participants,
    decisions: meetingFacts.decisions,
    openQuestions: meetingFacts.openQuestions,
    blockers: meetingFacts.blockers,
    actionItems: ownerMap.actionItems,
    ambiguousCommitments: ownerMap.ambiguousCommitments,
    timeline: timeline.tasks,
    pmFormat,
    timelineSeed,
  };

  await fs.writeFile(path.join(outDir, 'raw-transcript.txt'), `${input.transcript.trim()}\n`);
  if (input.mockToolResponse) {
    await fs.writeFile(path.join(outDir, 'mock-tool-response.yaml'), input.mockToolResponse);
  }
  await writeJson(path.join(outDir, 'analysis.json'), analysis);
  await fs.writeFile(path.join(outDir, 'meeting-summary.md'), renderMeetingSummary(title, organization, summaryText, analysis));
  await fs.writeFile(path.join(outDir, 'decisions-open-questions-blockers.md'), renderFactsMarkdown(analysis));
  await fs.writeFile(path.join(outDir, 'draft-emails.md'), renderAllEmails(emails));
  await fs.writeFile(path.join(outDir, 'project-timeline.md'), renderTimelineMarkdown(timeline, pmFormat));
  await fs.writeFile(path.join(outDir, 'clarifications.md'), renderClarifications(analysis.ambiguousCommitments));
  await fs.writeFile(path.join(outDir, 'tasks.csv'), toCsv(timeline.tasks.map(taskToCsvRow)));

  for (const email of emails) {
    await fs.writeFile(path.join(outDir, 'draft-emails', `${slugify(email.owner)}.md`), renderEmail(email));
  }

  await fs.writeFile(path.join(outDir, 'index.html'), renderHtml(title, organization, analysis, summaryText, emails, timeline, input));

  console.log(`Transcript turns: ${turns.length}`);
  console.log(`Decisions: ${analysis.decisions.length}`);
  console.log(`Action items: ${analysis.actionItems.length}`);
  console.log(`Ambiguous commitments: ${analysis.ambiguousCommitments.length}`);
  console.log(`Draft emails: ${emails.length}`);
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
}

async function loadTranscriptInput(args, config) {
  if (args.transcript) {
    const absolute = path.resolve(args.transcript);
    if (!existsSync(absolute)) throw new Error(`Transcript not found: ${absolute}`);
    return {
      title: path.basename(absolute).replace(/\.[^.]+$/, ''),
      source: absolute,
      transcript: await fs.readFile(absolute, 'utf8'),
      participants: [],
    };
  }

  const id = args['mock-transcript'] ?? config.sample?.mockTranscript;
  if (!id) throw new Error('Missing --transcript or --mock-transcript');
  const toolPath = path.join(ROOT, 'tools/mock-transcript-api');
  const yaml = run(toolPath, ['get', id], { timeout: 30000 });
  return {
    title: extractScalar(yaml, 'title') || id,
    source: `mock-transcript-api:${id}`,
    recordedAt: extractScalar(yaml, 'recorded_at'),
    participants: extractParticipants(yaml),
    transcript: extractBlock(yaml, 'transcript'),
    mockToolResponse: yaml,
  };
}

function extractScalar(yaml, key) {
  const match = yaml.match(new RegExp(`^${escapeRegex(key)}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^"|"$/g, '') : '';
}

function extractBlock(yaml, key) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}: |`);
  if (start === -1) return '';
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line && !line.startsWith('  ')) break;
    out.push(line.replace(/^  /, ''));
  }
  return `${out.join('\n').trim()}\n`;
}

function extractParticipants(yaml) {
  const lines = yaml.split(/\r?\n/);
  const participants = [];
  let current = null;
  for (const line of lines) {
    if (/^\s*-\s+name:\s+/.test(line)) {
      if (current) participants.push(current);
      current = { name: line.replace(/^\s*-\s+name:\s+/, '').trim() };
    } else if (current && /^\s+role:\s+/.test(line)) {
      current.role = line.replace(/^\s+role:\s+/, '').trim();
    } else if (current && /^\s+email:\s+/.test(line)) {
      current.email = line.replace(/^\s+email:\s+/, '').trim();
    } else if (current && line.trim() === 'transcript: |') {
      break;
    }
  }
  if (current) participants.push(current);
  return participants;
}

function parseTranscript(raw) {
  return raw.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^(?:(\d{1,2}:\d{2}(?::\d{2})?)\s+)?([^:]{2,80}):\s*(.*)$/);
      if (!match) {
        return { index, timestamp: '', speaker: 'Unknown', text: line };
      }
      return {
        index,
        timestamp: match[1] ?? '',
        speaker: match[2].trim(),
        text: match[3].trim(),
      };
    });
}

function inferParticipants(turns) {
  return [...new Set(turns.map((turn) => turn.speaker))]
    .filter((name) => name !== 'Unknown')
    .map((name) => ({ name, email: `${slugify(name).replaceAll('-', '.')}@example.com` }));
}

function extractMeetingFacts(turns) {
  const decisions = [];
  const openQuestions = [];
  const blockers = [];

  for (const turn of turns) {
    const text = turn.text;
    const lower = text.toLowerCase();
    if (lower.includes('decision:') || lower.includes('we decided') || lower.includes('we are keeping') || lower.includes('we will use') || lower.includes('beta goes')) {
      decisions.push(factItem(turn, cleanFact(text.replace(/^decision:\s*/i, ''))));
    }
    if (text.includes('?') || lower.includes('open question') || lower.includes('need clarity') || lower.includes('need the final') || lower.includes('need traffic')) {
      openQuestions.push(factItem(turn, cleanFact(text.replace(/^open question:\s*/i, ''))));
    }
    const blockerSignal =
      /\b(blocked|blocking)\b/.test(lower) ||
      lower.includes('one more blocker') ||
      lower.includes('waiting on') ||
      lower.includes('flaky') ||
      lower.includes('needs legal') ||
      (lower.includes('risk') && !lower.includes('agenda'));
    if (blockerSignal) {
      blockers.push(factItem(turn, cleanFact(text)));
    }
  }

  return {
    decisions: dedupeFacts(decisions),
    openQuestions: dedupeFacts(openQuestions),
    blockers: dedupeFacts(blockers),
  };
}

function factItem(turn, text) {
  return {
    text,
    speaker: turn.speaker,
    timestamp: turn.timestamp,
    evidence: `${turn.speaker}: ${turn.text}`,
  };
}

function cleanFact(text) {
  return String(text).replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

function dedupeFacts(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractActionItems(turns, participants) {
  const actionItems = [];
  const ambiguousCommitments = [];
  const participantNames = participants.map((participant) => participant.name);
  const lastAssignedByOwner = new Map();

  for (const turn of turns) {
    const text = turn.text;
    const firstPerson = extractFirstPersonCommitment(turn);
    if (firstPerson) {
      if (isContextOnlyCommitment(firstPerson.task) && lastAssignedByOwner.has(turn.speaker)) {
        const previous = lastAssignedByOwner.get(turn.speaker);
        if (firstPerson.due && previous.dueDate === 'needs date') {
          previous.dueDate = firstPerson.due;
        }
        continue;
      }
      const item = makeActionItem(turn.speaker, firstPerson.task, firstPerson.due, turn, firstPerson.ambiguous);
      actionItems.push(item);
      if (item.ambiguous) ambiguousCommitments.push(item);
      lastAssignedByOwner.set(item.owner, item);
      continue;
    }

    const assignment = extractNamedAssignment(turn, participantNames);
    if (assignment) {
      const item = makeActionItem(assignment.owner, assignment.task, assignment.due, turn, assignment.ambiguous);
      actionItems.push(item);
      if (item.ambiguous) ambiguousCommitments.push(item);
      lastAssignedByOwner.set(item.owner, item);
    }
  }

  return {
    actionItems: mergeDuplicateActions(actionItems),
    ambiguousCommitments: mergeDuplicateActions(ambiguousCommitments),
  };
}

function extractFirstPersonCommitment(turn) {
  const text = turn.text.trim();
  const lower = text.toLowerCase();
  const match = text.match(/^(?:(?:yes|yep|yeah|sure|perfect|sounds good|got it|okay|ok)[,.\s]+)?(I will|I'll|I can|I am going to|I'm going to|I need to|I still need to)\b\s+(.+)/i);
  if (!match) return null;
  let task = match[2].trim();
  task = task.replace(/^have\s+/i, 'prepare ');
  const due = extractDueDate(task);
  task = removeDuePhrase(task);
  const ambiguous = isAmbiguousTask(task) || lower.includes('look into that');
  return { task: cleanTask(task), due, ambiguous };
}

function extractNamedAssignment(turn, participantNames) {
  const text = turn.text.trim();
  for (const name of participantNames) {
    const first = name.split(/\s+/)[0];
    const direct = new RegExp(`^${escapeRegex(first)},\\s+(?:can you|please)\\s+(.+)`, 'i').exec(text);
    if (direct) {
      const due = extractDueDate(direct[1]);
      return { owner: name, task: cleanTask(removeDuePhrase(direct[1])), due, ambiguous: isAmbiguousTask(direct[1]) };
    }
  }

  const recap = text.match(/Action recap:\s*(.+)$/i);
  if (!recap) return null;
  return null;
}

function makeActionItem(owner, task, due, turn, ambiguous = false) {
  const cleanedTask = cleanTask(task);
  const title = titleCase(cleanedTask);
  return {
    id: hash(`${owner}|${task}|${turn.index}`),
    owner,
    task: cleanedTask,
    title,
    dueDate: due || 'needs date',
    status: ambiguous ? 'needs clarification' : 'open',
    ambiguous,
    sourceSpeaker: turn.speaker,
    timestamp: turn.timestamp,
    evidence: `${turn.speaker}: ${turn.text}`,
  };
}

function mergeDuplicateActions(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.owner}|${item.task}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractDueDate(text) {
  const patterns = [
    /\bby\s+(today|tomorrow|eod|eow|friday|thursday|wednesday|tuesday|monday|next tuesday|monday morning|thursday afternoon)\b/i,
    /\bbefore\s+([a-z]+day|standup tomorrow|friday)\b/i,
    /\b(today|tomorrow|next week)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].replace(/^by\s+/i, '').trim();
  }
  return '';
}

function removeDuePhrase(text) {
  return text
    .replace(/\s+by\s+(today|tomorrow|eod|eow|friday|thursday|wednesday|tuesday|monday|next tuesday|monday morning|thursday afternoon)\b.*$/i, '')
    .replace(/\s+before\s+([a-z]+day|standup tomorrow|friday)\b.*$/i, '')
    .replace(/\s+(today|tomorrow|next week)\b.*$/i, '')
    .trim();
}

function isAmbiguousTask(task) {
  const lower = String(task).toLowerCase();
  return lower === 'look into that' ||
    lower.includes('look into that') ||
    lower.includes('figure it out') ||
    lower.includes('circle back') ||
    lower.length < 12;
}

function isContextOnlyCommitment(task) {
  const lower = cleanTask(task).toLowerCase();
  return lower === 'do that' ||
    lower === 'take that' ||
    lower === 'handle that';
}

function cleanTask(task) {
  return String(task)
    .replace(/update the dashboard using those event names/i, 'update the analytics dashboard using the final event names')
    .replace(/\s+and\s+post\s+the\s+result.*$/i, '')
    .replace(/\s+after\s+legal\s+signs.*$/i, '')
    .replace(/^have\s+/i, 'prepare ')
    .replace(/\s+ready$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .trim();
}

function buildTimelineSeed(turns) {
  return turns
    .filter((turn) => /launch|beta|by |today|tomorrow|next tuesday|monday|thursday|friday/i.test(turn.text))
    .map((turn) => ({ speaker: turn.speaker, timestamp: turn.timestamp, text: turn.text }));
}

function buildTimeline(actionItems, blockers, pmFormat) {
  const tasks = actionItems.map((item) => ({
    title: item.title,
    owner: item.owner,
    dueDate: item.dueDate,
    status: item.status,
    dependency: findDependency(item, blockers),
    evidence: item.evidence,
    pmFormat,
  }));
  tasks.sort(compareTasks);
  return { tasks };
}

function compareTasks(a, b) {
  return dueRank(a.dueDate) - dueRank(b.dueDate) || a.owner.localeCompare(b.owner);
}

function dueRank(due) {
  const lower = String(due).toLowerCase();
  if (lower.includes('today')) return 1;
  if (lower.includes('tomorrow')) return 2;
  if (lower.includes('monday')) return 3;
  if (lower.includes('thursday')) return 4;
  if (lower.includes('friday')) return 5;
  if (lower.includes('tuesday')) return 6;
  if (lower.includes('needs')) return 99;
  return 50;
}

function findDependency(item, blockers) {
  const lower = `${item.task} ${item.evidence}`.toLowerCase();
  if (lower.includes('screenshot') || lower.includes('copy')) return 'Legal copy approval';
  if (lower.includes('webhook')) return 'Payment provider sandbox';
  if (lower.includes('dashboard')) return 'Final event names and traffic estimate';
  if (lower.includes('announcement')) return 'Approved screenshots';
  if (lower.includes('apple pay')) return 'QA reproduction details';
  const blocker = blockers.find((candidate) => lower.split(/\W+/).some((word) => word.length > 5 && candidate.text.toLowerCase().includes(word)));
  return blocker ? blocker.text : 'none';
}

function draftEmails(actionItems, participants, title, organization) {
  const byOwner = new Map();
  for (const item of actionItems) {
    const list = byOwner.get(item.owner) ?? [];
    list.push(item);
    byOwner.set(item.owner, list);
  }
  return [...byOwner.entries()].map(([owner, items]) => {
    const participant = participants.find((person) => person.name === owner) ?? { name: owner, email: `${slugify(owner).replaceAll('-', '.')}@example.com` };
    const ambiguous = items.filter((item) => item.ambiguous);
    const subject = `Follow-up: ${title} commitments`;
    const body = [
      `Hi ${owner.split(/\s+/)[0]},`,
      '',
      `Following up from ${title}, here is what I have you owning:`,
      '',
      ...items.map((item) => `- ${item.title}${item.dueDate !== 'needs date' ? ` by ${item.dueDate}` : ' (date needed)'}. Reference: "${item.evidence}"`),
      '',
      ambiguous.length
        ? `One item is ambiguous: "${ambiguous[0].evidence}". Can you clarify exactly what "${ambiguous[0].task}" means, what output you will send, and when it will be done?`
        : 'Please reply if any owner, scope, or date is off.',
      '',
      'Thanks,',
      `${organization} meeting aftermath`,
    ].join('\n');
    return { owner, to: participant.email, subject, body, items };
  });
}

async function summarizeWithFallback(config, title, facts, ownerMap, timeline) {
  try {
    const prompt = await fs.readFile(path.join(ROOT, config.claws.extractor), 'utf8');
    const payload = {
      title,
      decisions: facts.decisions,
      openQuestions: facts.openQuestions,
      blockers: facts.blockers,
      actionItems: ownerMap.actionItems,
      ambiguousCommitments: ownerMap.ambiguousCommitments,
      timeline: timeline.tasks,
    };
    const response = await callOllama(config, [
      { role: 'system', content: `${prompt}\nWrite a concise executive meeting summary in Markdown. Do not invent facts.` },
      { role: 'user', content: `/no_think\n${JSON.stringify(payload)}` },
    ]);
    return response.trim() || deterministicSummary(title, facts, ownerMap, timeline);
  } catch (error) {
    return `${deterministicSummary(title, facts, ownerMap, timeline)}\n\n_Model summary fallback used: ${error.message}_`;
  }
}

function deterministicSummary(title, facts, ownerMap, timeline) {
  const firstDecision = facts.decisions[0]?.text ?? 'No explicit decision was found.';
  const firstBlocker = facts.blockers[0]?.text ?? 'No blocker was stated.';
  const ambiguous = ownerMap.ambiguousCommitments[0];
  const ambiguousLine = ambiguous
    ? `The important ambiguity: ${ambiguous.owner} said "${ambiguous.evidence}", which needs a concrete task and date.`
    : 'No ambiguous commitment was found.';
  return `## ${title}\n\nThe meeting produced ${facts.decisions.length} decisions, ${ownerMap.actionItems.length} action items, and ${facts.blockers.length} blockers.\n\nTop decision: ${firstDecision}.\n\nTop blocker: ${firstBlocker}.\n\n${ambiguousLine}\n\nNext step: send the personalized follow-up emails and convert the timeline into the PM tool.`;
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
      temperature: config.temperature ?? 0.25,
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

function renderMeetingSummary(title, organization, summaryText, analysis) {
  return `# Meeting Summary: ${title}\n\nOrganization: ${organization}\n\n${summaryText}\n\n## Decisions\n\n${bulletList(analysis.decisions.map((item) => `${item.text} (${item.speaker})`))}\n\n## Open Questions\n\n${bulletList(analysis.openQuestions.map((item) => `${item.text} (${item.speaker})`))}\n\n## Blockers\n\n${bulletList(analysis.blockers.map((item) => `${item.text} (${item.speaker})`))}\n`;
}

function renderFactsMarkdown(analysis) {
  return `# Decisions, Open Questions, And Blockers\n\n## Decisions\n\n${factList(analysis.decisions)}\n\n## Open Questions\n\n${factList(analysis.openQuestions)}\n\n## Blockers\n\n${factList(analysis.blockers)}\n`;
}

function factList(items) {
  if (!items.length) return '- None found.\n';
  return items.map((item) => `- ${item.text}\n  Evidence: ${item.evidence}`).join('\n');
}

function renderAllEmails(emails) {
  return `# Draft Follow-Up Emails\n\n${emails.map(renderEmail).join('\n\n---\n\n')}\n`;
}

function renderEmail(email) {
  return `## ${email.owner}\n\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.body}\n`;
}

function renderTimelineMarkdown(timeline, pmFormat) {
  if (pmFormat === 'jira') {
    return `# Jira Task List\n\n${timeline.tasks.map((task) => `- Summary: ${task.title}\n  Assignee: ${task.owner}\n  Due: ${task.dueDate}\n  Status: ${task.status}\n  Dependency: ${task.dependency}`).join('\n')}\n`;
  }
  if (pmFormat === 'asana') {
    return `# Asana Task List\n\n${timeline.tasks.map((task) => `- [ ] ${task.title} | Owner: ${task.owner} | Due: ${task.dueDate} | Dependency: ${task.dependency}`).join('\n')}\n`;
  }
  if (pmFormat === 'linear') {
    return `# Linear-Ready Task List\n\n${timeline.tasks.map((task) => `- [${task.status === 'needs clarification' ? 'Clarify' : 'Todo'}] ${task.title}\n  - Owner: ${task.owner}\n  - Due: ${task.dueDate}\n  - Dependency: ${task.dependency}`).join('\n')}\n`;
  }
  return `# Project Timeline\n\n${markdownTable(['Task', 'Owner', 'Due', 'Status', 'Dependency'], timeline.tasks.map((task) => [task.title, task.owner, task.dueDate, task.status, task.dependency]))}\n`;
}

function renderClarifications(items) {
  if (!items.length) return '# Clarifications Needed\n\nNo ambiguous commitments found.\n';
  return `# Clarifications Needed\n\n${items.map((item) => `- **${item.owner}**: ${item.evidence}\n  Ask: What exactly will you deliver, and by when?`).join('\n')}\n`;
}

function renderHtml(title, organization, analysis, summaryText, emails, timeline, input) {
  const decisions = analysis.decisions.map((item) => `<li>${escapeHtml(item.text)}<br><span>${escapeHtml(item.evidence)}</span></li>`).join('');
  const blockers = analysis.blockers.map((item) => `<li>${escapeHtml(item.text)}<br><span>${escapeHtml(item.evidence)}</span></li>`).join('');
  const questions = analysis.openQuestions.map((item) => `<li>${escapeHtml(item.text)}<br><span>${escapeHtml(item.evidence)}</span></li>`).join('');
  const actions = analysis.actionItems.map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.dueDate)}</td><td>${escapeHtml(item.status)}</td></tr>`).join('');
  const emailCards = emails.map((email) => `<section class="email"><h3>${escapeHtml(email.owner)}</h3><p><b>To:</b> ${escapeHtml(email.to)}</p><p><b>Subject:</b> ${escapeHtml(email.subject)}</p><pre>${escapeHtml(email.body)}</pre></section>`).join('');
  const timelineRows = timeline.tasks.map((task) => `<tr><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.owner)}</td><td>${escapeHtml(task.dueDate)}</td><td>${escapeHtml(task.dependency)}</td></tr>`).join('');
  const ambiguous = analysis.ambiguousCommitments.map((item) => `<li><strong>${escapeHtml(item.owner)}</strong>: ${escapeHtml(item.evidence)}<br><em>Ask for clarification: exact deliverable and date.</em></li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meeting Aftermath: ${escapeHtml(title)}</title>
<style>
:root{--ink:#172026;--muted:#667085;--line:#d8dee8;--bg:#f6f7f9;--panel:#fff;--teal:#0f766e;--red:#b42318}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 20px 56px}h1{font-size:34px;line-height:1.1;margin:0 0 6px}h2{font-size:21px;margin:0 0 12px}.muted{color:var(--muted)}
.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0}.metric{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}.metric b{display:block;font-size:24px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.panel,.email{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;margin-bottom:18px}li{margin:0 0 10px}li span{color:var(--muted)}.ambiguous strong{color:var(--red)}
table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{padding:9px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;color:var(--muted)}pre{white-space:pre-wrap;background:#f1f4f8;border-radius:7px;padding:12px;overflow:auto}.narrative{font-size:16px}.narrative strong{color:var(--teal)}
@media(max-width:820px){.summary,.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<main>
  <h1>Meeting Aftermath Machine</h1>
  <div class="muted">${escapeHtml(title)} &middot; ${escapeHtml(organization)} &middot; ${escapeHtml(input.source)}</div>
  <section class="summary">
    <div class="metric"><span>Decisions</span><b>${analysis.decisions.length}</b></div>
    <div class="metric"><span>Actions</span><b>${analysis.actionItems.length}</b></div>
    <div class="metric"><span>Draft emails</span><b>${emails.length}</b></div>
    <div class="metric"><span>Clarifications</span><b>${analysis.ambiguousCommitments.length}</b></div>
  </section>
  <section class="panel narrative">${markdownToHtml(summaryText)}</section>
  <section class="grid">
    <div class="panel"><h2>Decisions</h2><ul>${decisions || '<li>None found.</li>'}</ul></div>
    <div class="panel"><h2>Open Questions</h2><ul>${questions || '<li>None found.</li>'}</ul></div>
  </section>
  <section class="grid">
    <div class="panel"><h2>Blockers</h2><ul>${blockers || '<li>None found.</li>'}</ul></div>
    <div class="panel ambiguous"><h2>Ambiguous Commitments</h2><ul>${ambiguous || '<li>None found.</li>'}</ul></div>
  </section>
  <section class="panel"><h2>Action Items</h2><table><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead><tbody>${actions}</tbody></table></section>
  <section class="panel"><h2>Project Timeline</h2><table><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Dependency</th></tr></thead><tbody>${timelineRows}</tbody></table></section>
  <section><h2>Draft Emails</h2>${emailCards}</section>
</main>
</body>
</html>`;
}

function markdownToHtml(markdown) {
  return escapeHtml(markdown)
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

function taskToCsvRow(task) {
  return {
    title: task.title,
    owner: task.owner,
    due_date: task.dueDate,
    status: task.status,
    dependency: task.dependency,
    evidence: task.evidence,
  };
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`;
}

function csvEscape(value) {
  const raw = String(value ?? '');
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function bulletList(items) {
  return items.length ? `${items.map((item) => `- ${item}`).join('\n')}\n` : '- None found.\n';
}

function markdownTable(headers, rows) {
  return `${headers.join(' | ')}\n${headers.map(() => '---').join(' | ')}\n${rows.map((row) => row.join(' | ')).join('\n')}`;
}

function titleCase(text) {
  const cleaned = cleanTask(text);
  if (!cleaned) return 'Clarify commitment';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function hash(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = Math.imul(31, h) + value.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'meeting';
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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
