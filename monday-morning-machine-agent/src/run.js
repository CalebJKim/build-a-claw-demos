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
  temperature: 0.35,
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
    if (['help', 'skip-model', 'no-actions'].includes(key)) {
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
  monday-morning-machine doctor
  monday-morning-machine run --ask "Get me ready for my week."

Options:
  --skip-model        Use deterministic synthesis instead of calling Ollama.
  --no-actions        Prepare action plan but do not write mock action receipts.
  --ask <text>        Natural-language trigger.
  --out <path>        Output directory.
  --model <name>      Model id override.
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
  checks.push(['mock-calendar', existsSync(path.join(ROOT, 'tools/mock-calendar')) ? 'present' : 'missing']);
  checks.push(['mock-inbox', existsSync(path.join(ROOT, 'tools/mock-inbox')) ? 'present' : 'missing']);
  checks.push(['mock-world-search', existsSync(path.join(ROOT, 'tools/mock-world-search')) ? 'present' : 'missing']);
  checks.push(['mock-action-api', existsSync(path.join(ROOT, 'tools/mock-action-api')) ? 'present' : 'missing']);
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
  const ask = args.ask ?? config.sample?.ask ?? 'Get me ready for my week.';
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'runs', `${timestamp()}-monday-morning-machine`));
  const toolDir = path.join(outDir, 'tool-responses');
  await fs.mkdir(toolDir, { recursive: true });

  console.log(`Ask: ${ask}`);
  console.log(`Output: ${outDir}`);

  const startedAt = new Date().toISOString();
  const [calendarPayload, inboxPayload] = await Promise.all([
    toolJson(path.join(ROOT, 'tools/mock-calendar'), ['week']),
    toolJson(path.join(ROOT, 'tools/mock-inbox'), ['last72']),
  ]);
  await writeJson(path.join(toolDir, 'calendar.json'), calendarPayload);
  await writeJson(path.join(toolDir, 'inbox.json'), inboxPayload);

  const calendarFindings = analyzeCalendar(calendarPayload);
  const inboxFindings = analyzeInbox(inboxPayload);
  const worldFindings = await runWorldCheck(calendarPayload, inboxPayload, toolDir);
  const prep = synthesizePrep(ask, calendarPayload, calendarFindings, inboxFindings, worldFindings);
  if (!args['skip-model']) {
    prep.executiveSummary = await polishExecutiveSummaryWithFallback(effectiveConfig, ask, prep);
  }
  const actions = await executeMockActions(outDir, prep, args['no-actions']);

  const analysis = {
    ask,
    generatedAt: new Date().toISOString(),
    startedAt,
    sourceMode: 'mock calendar, mock inbox, seeded mock web search, mock-safe actions',
    parallelLanes: [
      { claw: 'calendar', tool: 'tools/mock-calendar week', status: 'complete' },
      { claw: 'inbox', tool: 'tools/mock-inbox last72', status: 'complete' },
      { claw: 'world', tool: 'tools/mock-world-search search <query>', status: 'complete' },
      { claw: 'prep', tool: 'synthesis', status: 'complete' },
      { claw: 'executor', tool: 'tools/mock-action-api', status: actions.executed ? 'complete' : 'planned-only' },
    ],
    calendar: calendarFindings,
    inbox: inboxFindings,
    world: worldFindings,
    prep,
    actions,
  };

  await fs.writeFile(path.join(outDir, 'ask.txt'), `${ask}\n`);
  await fs.writeFile(path.join(outDir, 'calendar-prep.md'), renderCalendarPrep(calendarFindings, prep.meetingBriefs));
  await fs.writeFile(path.join(outDir, 'inbox-triage.md'), renderInboxTriage(inboxFindings, prep.emailDrafts));
  await fs.writeFile(path.join(outDir, 'world-check.md'), renderWorldCheck(worldFindings));
  await fs.writeFile(path.join(outDir, 'weekly-brief.md'), renderWeeklyBrief(prep, actions));
  await fs.writeFile(path.join(outDir, 'actions-taken.md'), renderActionsTaken(actions));
  await writeJson(path.join(outDir, 'analysis.json'), analysis);
  await fs.writeFile(path.join(outDir, 'index.html'), renderReportHtml(prep, actions, worldFindings));

  console.log(`Important meetings: ${prep.meetingBriefs.length}`);
  console.log(`Email drafts: ${prep.emailDrafts.length}`);
  console.log(`World hits: ${worldFindings.results.length}`);
  console.log(`Actions ${actions.executed ? 'taken' : 'planned'}: ${actions.items.length}`);
  console.log(`Brief: ${path.join(outDir, 'weekly-brief.md')}`);
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
}

function analyzeCalendar(payload) {
  const events = payload.events ?? [];
  const underPrepared = [];
  for (const event of events) {
    const flags = [];
    if ((event.attendees ?? []).length > 1 && !String(event.agenda ?? '').trim()) {
      flags.push('No agenda');
    }
    if ((event.tags ?? []).includes('1:1') && Number(event.lastContactDays ?? 0) >= 21) {
      flags.push(`Stale 1:1: no meaningful contact in ${event.lastContactDays} days`);
    }
    if ((event.tags ?? []).some((tag) => ['presentation', 'investor'].includes(tag)) && !(event.attachedDocs ?? []).length) {
      flags.push('Presentation block with no attached deck');
    }
    if (['high', 'critical'].includes(event.stakes) && !hasPrepBlockBefore(event, events)) {
      flags.push('High-stakes meeting without a nearby focus block');
    }
    const overlaps = events
      .filter((candidate) => candidate.id !== event.id && overlapsEvent(event, candidate))
      .map((candidate) => candidate.title);
    if (overlaps.length) {
      flags.push(`Double-booked with ${overlaps.join(', ')}`);
    }
    if (flags.length) {
      underPrepared.push({ eventId: event.id, title: event.title, start: event.start, stakes: event.stakes, flags });
    }
  }

  return {
    weekOf: payload.weekOf,
    timezone: payload.timezone,
    user: payload.user,
    totalEvents: events.length,
    importantMeetings: events.filter((event) => ['high', 'critical'].includes(event.stakes) || (event.tags ?? []).includes('1:1')),
    underPrepared,
  };
}

function analyzeInbox(payload) {
  const mondayEnd = new Date('2026-05-18T23:59:59-07:00');
  const threads = payload.threads ?? [];
  const needsToday = threads
    .filter((thread) => thread.needsReply && thread.deadline && new Date(thread.deadline) <= mondayEnd)
    .sort(compareDeadlineThenStakes);
  const needsThisWeek = threads
    .filter((thread) => thread.needsReply)
    .sort(compareDeadlineThenStakes);
  const commitments = needsThisWeek
    .filter((thread) => thread.commitmentByUser)
    .map((thread) => ({
      threadId: thread.id,
      subject: thread.subject,
      commitment: thread.commitmentByUser,
      deadline: thread.deadline,
      stakes: thread.stakes,
      status: thread.status,
    }));

  return {
    window: payload.window,
    totalThreads: threads.length,
    needsToday,
    needsThisWeek,
    commitments,
  };
}

async function runWorldCheck(calendarPayload, inboxPayload, toolDir) {
  const queries = buildWorldQueries(calendarPayload, inboxPayload);
  const responses = await Promise.all(queries.map((query) => toolJson(path.join(ROOT, 'tools/mock-world-search'), ['search', query])));
  for (let i = 0; i < responses.length; i += 1) {
    await writeJson(path.join(toolDir, `world-${slugify(queries[i])}.json`), responses[i]);
  }
  const deduped = new Map();
  for (const response of responses) {
    for (const result of response.results ?? []) {
      if (!deduped.has(result.id)) deduped.set(result.id, result);
    }
  }
  const results = [...deduped.values()].sort((a, b) => b.score - a.score || a.publishedAt.localeCompare(b.publishedAt));
  return {
    queries,
    sourceMode: responses[0]?.sourceMode ?? 'mock world search',
    asOf: responses[0]?.asOf,
    results,
  };
}

function buildWorldQueries(calendarPayload, inboxPayload) {
  const tags = new Set();
  for (const event of calendarPayload.events ?? []) {
    for (const tag of event.tags ?? []) tags.add(tag);
    if (event.sector) tags.add(event.sector);
  }
  for (const thread of inboxPayload.threads ?? []) {
    if (/pricing|security|rollout/i.test(thread.snippet)) tags.add('energy security procurement');
    if (/workflow cards|competitor/i.test(thread.snippet)) tags.add('AI developer tools workflow cards competitors');
    if (/investor|retention/i.test(thread.snippet)) tags.add('fundraising SaaS retention');
  }
  return [
    'energy grid security vendor reliability',
    'AI developer tools workflow cards competitors',
    'fundraising SaaS retention expansion revenue',
    'developer onboarding workflow templates',
  ].filter((query, index, all) => all.indexOf(query) === index || tags.size);
}

function synthesizePrep(ask, calendarPayload, calendarFindings, inboxFindings, worldFindings) {
  const worldByTag = (tag) => worldFindings.results.find((item) => (item.queryTags ?? []).some((queryTag) => queryTag.toLowerCase().includes(tag)));
  const emailBySubject = (needle) => inboxFindings.needsThisWeek.find((thread) => thread.subject.toLowerCase().includes(needle));
  const eventByTitle = (needle) => calendarFindings.importantMeetings.find((event) => event.title.toLowerCase().includes(needle));

  const energyNews = worldByTag('energy');
  const competitorNews = worldByTag('workflow');
  const investorNews = worldByTag('investor') ?? worldByTag('fundraising');

  const meetingBriefs = calendarFindings.importantMeetings.map((event) => {
    const flags = calendarFindings.underPrepared.find((item) => item.eventId === event.id)?.flags ?? [];
    let angle = 'Walk in with a crisp desired outcome and one decision you need from the room.';
    if (event.title.includes('EnergyCo')) {
      angle = `Sarah and procurement will care about rollout risk and auditability. Bring pricing, security deltas, and use the weekend grid reliability checklist as your frame: ${energyNews?.headline ?? 'vendor reliability is the theme'}.`;
    } else if (event.title.includes('Product review')) {
      angle = `AsterFlow shipped workflow cards this weekend, so the question is no longer whether the category exists. Decide whether LaunchLens narrows workflow cards into a defendable Q3 slice.`;
    } else if (event.title.includes('Priya')) {
      angle = 'Priya is asking for direction, not another brainstorm. Open with a clear call: keep workflow cards in scope, narrow the first release, and ask what tradeoff she needs you to unblock.';
    } else if (event.title.includes('Investor')) {
      angle = `Ari wants expansion narrative and net retention. Bring one slide that ties EnergyCo renewal quality to expansion revenue, not just pipeline.`;
    }
    return {
      title: event.title,
      when: formatDateTime(event.start),
      attendees: event.attendees,
      stakes: event.stakes,
      flags,
      brief: `${angle} ${flags.length ? `Fix before the meeting: ${flags.join('; ')}.` : 'No obvious prep gap found.'}`,
    };
  });

  const emailDrafts = inboxFindings.needsThisWeek.slice(0, 3).map((thread) => ({
    threadId: thread.id,
    to: thread.from,
    subject: `Re: ${thread.subject}`,
    deadline: thread.deadline,
    body: draftReply(thread, { energyNews, competitorNews, investorNews }),
  }));

  const taskList = [
    {
      task: 'Send EnergyCo pricing and security questionnaire delta',
      deadline: '2026-05-18T15:00:00-07:00',
      stakes: 'critical',
      reason: 'Client asked before Monday EOD and Wednesday commercial review includes procurement/security.',
    },
    {
      task: 'Decide LaunchLens workflow-card scope before Tuesday product review',
      deadline: '2026-05-19T09:00:00-07:00',
      stakes: 'high',
      reason: 'Competitor shipped workflow cards over the weekend and Priya/Maya both need direction.',
    },
    {
      task: 'Prepare investor update deck with expansion revenue narrative',
      deadline: '2026-05-20T10:00:00-07:00',
      stakes: 'high',
      reason: 'Dry run lacks an attached deck and investor focus is net retention/expansion quality.',
    },
    {
      task: 'Create agenda for Priya 1:1',
      deadline: '2026-05-19T12:00:00-07:00',
      stakes: 'medium',
      reason: 'No meaningful contact in 24 days and she requested a decision.',
    },
  ].sort(compareTask);

  const weekAtGlance = [
    'Monday is client-response heavy: EnergyCo needs pricing/security before 3pm.',
    'Tuesday is product direction: workflow cards need a crisp in/out decision.',
    'Wednesday is risky: investor dry run overlaps EnergyCo commercial review, and the deck is not attached.',
    'Thursday/Friday are execution and demo review once the front half is stabilized.',
  ];

  return {
    ask,
    executiveSummary: 'Your week has three real pressure points: EnergyCo commercial risk, LaunchLens workflow-card positioning after a competitor move, and an investor narrative that still needs a deck. I protected prep time, sent the urgent replies in demo mode, and posted the brief where the team can see it.',
    weekAtGlance,
    meetingBriefs,
    emailDrafts,
    taskList,
    worldImplications: [
      energyNews ? `${energyNews.headline}: ${energyNews.whyItMatters}` : 'Energy sector check found no high-impact update.',
      competitorNews ? `${competitorNews.headline}: ${competitorNews.whyItMatters}` : 'Competitor check found no high-impact update.',
      investorNews ? `${investorNews.headline}: ${investorNews.whyItMatters}` : 'Investor check found no high-impact update.',
    ],
    underPrepared: calendarFindings.underPrepared,
    keyEmailThreads: inboxFindings.needsToday,
    doubleBooked: calendarFindings.underPrepared.filter((item) => item.flags.some((flag) => flag.includes('Double-booked'))),
    anchors: {
      energyMeeting: eventByTitle('energyco')?.id,
      productReview: eventByTitle('product review')?.id,
      energyEmail: emailBySubject('pricing')?.id,
      priyaEmail: emailBySubject('decision')?.id,
    },
  };
}

function draftReply(thread, context) {
  if (thread.subject.includes('updated rollout pricing')) {
    return `Sarah - I will send the updated rollout pricing by 2:00pm today, plus a short security-questionnaire delta so procurement can see what changed and what did not. For Wednesday, I will frame this around rollout risk, auditability, and response process; there was also a new vendor reliability checklist published this morning that maps cleanly to the review.`;
  }
  if (thread.subject.includes('Decision needed')) {
    return `Priya - direction for tomorrow: keep workflow cards in Q3 scope, but narrow the first release to reusable cards for the three highest-frequency developer workflows. AsterFlow shipping this over the weekend makes the category real, so I do not want us to punt; I want us to reduce surface area and win on validation quality. Let's use the 1:1 to lock the tradeoffs.`;
  }
  if (thread.subject.includes('Roadmap review prep')) {
    return `Maya - yes, defend workflow cards, but frame it as a narrowed Q3 wedge rather than the full concept. AsterFlow shipping cards this weekend means the market is moving; our argument should be that LaunchLens wins on validation, templates, and operator trust rather than trying to out-feature them immediately.`;
  }
  if (thread.subject.includes('Deck before dry run')) {
    return `Ari - yes. I will send the deck before 10:00am Wednesday. I am tightening the expansion narrative around renewal quality, EnergyCo usage, and net-retention proof rather than broad new-logo pipeline.`;
  }
  return `Thanks - I saw this and will follow up with a concrete answer before the deadline.`;
}

async function polishExecutiveSummaryWithFallback(config, ask, prep) {
  try {
    const prompt = await fs.readFile(path.join(ROOT, config.claws.prep), 'utf8');
    const response = await callOllama(config, [
      { role: 'system', content: `${prompt}\nReturn one crisp paragraph only. Do not mention that data is mocked.` },
      { role: 'user', content: `/no_think\n${JSON.stringify({ ask, prep })}` },
    ]);
    return response.trim().split(/\n+/).join(' ').slice(0, 1000) || prep.executiveSummary;
  } catch {
    return prep.executiveSummary;
  }
}

async function executeMockActions(outDir, prep, noActions) {
  const actionDir = path.join(outDir, 'actions');
  await fs.mkdir(path.join(actionDir, 'draft-emails'), { recursive: true });
  await fs.mkdir(path.join(actionDir, 'calendar-blocks'), { recursive: true });

  const planned = [
    ...prep.emailDrafts.map((draft) => ({ type: 'send-email', payload: draft })),
    {
      type: 'create-calendar-block',
      payload: {
        title: 'Focus: EnergyCo pricing + security delta',
        start: '2026-05-18T13:00:00-07:00',
        end: '2026-05-18T14:00:00-07:00',
        reason: 'Protect time before the 3pm client deadline.',
      },
    },
    {
      type: 'create-calendar-block',
      payload: {
        title: 'Focus: LaunchLens workflow-card decision',
        start: '2026-05-19T08:30:00-07:00',
        end: '2026-05-19T09:30:00-07:00',
        reason: 'Prep product review after competitor workflow-card launch.',
      },
    },
    {
      type: 'create-calendar-block',
      payload: {
        title: 'Focus: investor deck final pass',
        start: '2026-05-20T09:00:00-07:00',
        end: '2026-05-20T10:00:00-07:00',
        reason: 'Deck is missing before Wednesday dry run.',
      },
    },
    {
      type: 'post-note',
      payload: {
        destination: 'Weekly Brief note',
        title: 'Monday Morning Brief - 2026-05-18',
        summary: prep.executiveSummary,
      },
    },
    {
      type: 'post-slack',
      payload: {
        channel: '#weekly-prep',
        text: 'Weekly brief is ready. EnergyCo pricing, LaunchLens workflow-card decision, and investor deck are the top three.',
      },
    },
  ];

  const receipts = [];
  if (!noActions) {
    for (const item of planned) {
      const receipt = await actionTool(item.type, actionDir, item.payload);
      receipts.push(receipt);
      if (item.type === 'send-email') {
        await fs.writeFile(path.join(actionDir, 'draft-emails', `${item.payload.threadId}.md`), renderEmailDraft(item.payload, receipt));
      }
      if (item.type === 'create-calendar-block') {
        await writeJson(path.join(actionDir, 'calendar-blocks', `${slugify(item.payload.title)}.json`), receipt);
      }
    }
  }

  return {
    executed: !noActions,
    items: noActions ? planned.map((item) => ({ ...item, approved: false, demoMode: true })) : receipts,
    actionDir,
  };
}

async function actionTool(command, outDir, payload) {
  const stdout = run(path.join(ROOT, 'tools/mock-action-api'), [command, outDir, JSON.stringify(payload)], { timeout: 30000 });
  return JSON.parse(stdout);
}

function renderCalendarPrep(findings, briefs) {
  return `# Calendar Prep\n\nWeek of ${findings.weekOf}\n\n## Important Meetings\n\n${briefs.map((brief) => `### ${brief.title}\n\n- When: ${brief.when}\n- Stakes: ${brief.stakes}\n- Attendees: ${brief.attendees.join(', ')}\n- Prep flags: ${brief.flags.length ? brief.flags.join('; ') : 'none'}\n\n${brief.brief}`).join('\n\n')}\n\n## Under-Prepared Flags\n\n${findings.underPrepared.map((item) => `- **${item.title}**: ${item.flags.join('; ')}`).join('\n')}\n`;
}

function renderInboxTriage(findings, drafts) {
  return `# Inbox Triage\n\nWindow: ${findings.window}\n\n## Needs Response\n\n${findings.needsThisWeek.map((thread) => `- **${thread.subject}** from ${thread.from}\n  - Deadline: ${formatDateTime(thread.deadline)}\n  - Stakes: ${thread.stakes}\n  - Commitment: ${thread.commitmentByUser}`).join('\n')}\n\n## Draft Replies\n\n${drafts.map((draft) => renderEmailDraft(draft)).join('\n\n')}\n`;
}

function renderEmailDraft(draft, receipt = null) {
  return `### ${draft.subject}\n\nTo: ${draft.to}\nDeadline: ${formatDateTime(draft.deadline)}${receipt ? `\nReceipt: ${receipt.id}` : ''}\n\n${draft.body}\n`;
}

function renderWorldCheck(world) {
  return `# World Check\n\nSource mode: ${world.sourceMode}\nAs of: ${formatDateTime(world.asOf)}\n\n## Queries\n\n${world.queries.map((query) => `- ${query}`).join('\n')}\n\n## Hits\n\n${world.results.map((item) => `### ${item.headline}\n\n- Source: ${item.source}\n- Published: ${formatDateTime(item.publishedAt)}\n- URL: ${item.url}\n- Why it matters: ${item.whyItMatters}\n\n${item.summary}`).join('\n\n')}\n`;
}

function renderWeeklyBrief(prep, actions) {
  return `# Monday Morning Brief\n\n${prep.executiveSummary}\n\n## Here's Your Week At A Glance\n\n${prep.weekAtGlance.map((item) => `- ${item}`).join('\n')}\n\n## Here's What You Need To Know Walking Into Each Meeting\n\n${prep.meetingBriefs.map((brief) => `### ${brief.title}\n\n${brief.brief}`).join('\n\n')}\n\n## Here's What's Waiting In Your Inbox And What To Say\n\n${prep.emailDrafts.map((draft) => `### ${draft.subject}\n\n${draft.body}`).join('\n\n')}\n\n## Here's What The World Did Over The Weekend That Affects You\n\n${prep.worldImplications.map((item) => `- ${item}`).join('\n')}\n\n## Prioritized Task List\n\n${prep.taskList.map((task, index) => `${index + 1}. **${task.task}** (${task.stakes}, due ${formatDateTime(task.deadline)})\n   - ${task.reason}`).join('\n')}\n\n## Here's What I Already Did On Your Behalf\n\n${actions.items.map((item) => `- ${actions.executed ? 'Done' : 'Planned'}: ${describeAction(item)}`).join('\n')}\n`;
}

function renderActionsTaken(actions) {
  return `# Actions ${actions.executed ? 'Taken' : 'Planned'}\n\nMode: ${actions.executed ? 'mock-safe executed receipts' : 'planned only'}\n\n${actions.items.map((item) => `- ${describeAction(item)}${item.id ? ` (${item.id})` : ''}`).join('\n')}\n`;
}

function renderReportHtml(prep, actions, world) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monday Morning Machine</title>
<style>
:root{--ink:#18212f;--muted:#647084;--line:#d9e0ea;--bg:#f5f7fb;--panel:#fff;--blue:#2457d6;--green:#13795b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1120px;margin:0 auto;padding:34px 20px 56px}h1{font-size:34px;line-height:1.1;margin:0 0 8px}h2{font-size:22px;margin:0 0 12px}.muted{color:var(--muted)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;margin:0 0 18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.button{display:inline-block;background:var(--blue);color:white;text-decoration:none;border-radius:6px;padding:10px 14px;margin:0 8px 8px 0}.done{color:var(--green);font-weight:800}li{margin:0 0 8px}a{color:var(--blue)}
@media(max-width:800px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body><main>
<h1>Monday Morning Machine</h1>
<section class="panel"><p>${escapeHtml(prep.executiveSummary)}</p><p><a class="button" href="weekly-brief.md">Open weekly brief</a><a class="button" href="actions-taken.md">Open actions taken</a><a class="button" href="world-check.md">Open world check</a></p></section>
<section class="grid">
  <div class="panel"><h2>Week At A Glance</h2><ul>${prep.weekAtGlance.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
  <div class="panel"><h2>What I Already Did</h2><ul>${actions.items.map((item) => `<li><span class="done">${actions.executed ? 'Done' : 'Planned'}</span>: ${escapeHtml(describeAction(item))}</li>`).join('')}</ul></div>
</section>
<section class="panel"><h2>Meeting Prep</h2>${prep.meetingBriefs.map((brief) => `<h3>${escapeHtml(brief.title)}</h3><p>${escapeHtml(brief.brief)}</p>`).join('')}</section>
<section class="panel"><h2>World Check</h2><ul>${world.results.slice(0, 4).map((item) => `<li><strong>${escapeHtml(item.headline)}</strong><br><span class="muted">${escapeHtml(item.source)} - ${escapeHtml(item.url)}</span><br>${escapeHtml(item.whyItMatters)}</li>`).join('')}</ul></section>
</main></body></html>`;
}

function describeAction(item) {
  const command = item.command ?? item.type;
  const payload = item.payload ?? {};
  if (command === 'send-email') return `sent draft reply to ${payload.to} (${payload.subject})`;
  if (command === 'create-calendar-block') return `created calendar block "${payload.title}" from ${formatDateTime(payload.start)} to ${timeOnly(payload.end)}`;
  if (command === 'post-note') return `posted weekly brief to ${payload.destination}`;
  if (command === 'post-slack') return `posted summary to ${payload.channel}`;
  return command;
}

function hasPrepBlockBefore(event, events) {
  const start = new Date(event.start);
  return events.some((candidate) => {
    if (candidate.id === event.id || !(candidate.tags ?? []).includes('focus')) return false;
    const candidateEnd = new Date(candidate.end);
    const gapMs = start - candidateEnd;
    return gapMs >= 0 && gapMs <= 4 * 60 * 60 * 1000;
  });
}

function overlapsEvent(left, right) {
  return new Date(left.start) < new Date(right.end) && new Date(right.start) < new Date(left.end);
}

function compareDeadlineThenStakes(left, right) {
  const leftTime = left.deadline ? new Date(left.deadline).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right.deadline ? new Date(right.deadline).getTime() : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime || stakeWeight(right.stakes) - stakeWeight(left.stakes);
}

function compareTask(left, right) {
  return stakeWeight(right.stakes) - stakeWeight(left.stakes) || new Date(left.deadline) - new Date(right.deadline);
}

function stakeWeight(value) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[value] ?? 0;
}

async function toolJson(command, args) {
  const stdout = run(command, args, { timeout: 30000 });
  return JSON.parse(stdout);
}

async function callOllama(config, messages) {
  const response = await fetchJson(`${config.ollamaHost}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      temperature: config.temperature ?? 0.35,
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

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function formatDateTime(value) {
  if (!value) return 'not set';
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

function timeOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
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
    .slice(0, 80) || 'monday';
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
