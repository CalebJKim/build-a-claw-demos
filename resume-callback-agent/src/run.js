#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
process.env.PATH = `${path.join(os.homedir(), '.npm-global', 'bin')}:${process.env.PATH ?? ''}`;

const DEFAULT_CONFIG = {
  model: 'qwen3.6:35b-a3b',
  ollamaHost: 'http://127.0.0.1:11434',
  contextTokens: 32768,
  maxOutputTokens: 4096,
  temperature: 0.2,
  parallelClaws: true,
  search: {
    maxJobResults: 8,
    maxSalaryResults: 6,
    fetchPages: true,
    pageChars: 3500,
  },
  claws: {
    jobMarket: 'claws/job-market.md',
    resumeGap: 'claws/resume-gap.md',
    salary: 'claws/salary.md',
    lead: 'claws/lead.md',
    evidenceGuard: 'claws/evidence-guard.md',
    target: 'claws/target-infer.md',
  },
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
    if (['skip-web', 'serial', 'help'].includes(key)) {
      args[key] = true;
      continue;
    }
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

async function readConfig() {
  const configPath = path.join(ROOT, 'resume-claw.config.json');
  if (!existsSync(configPath)) return DEFAULT_CONFIG;
  const raw = await fs.readFile(configPath, 'utf8');
  return deepMerge(DEFAULT_CONFIG, JSON.parse(raw));
}

function deepMerge(base, next) {
  if (Array.isArray(base) || Array.isArray(next)) return next ?? base;
  if (!isPlainObject(base) || !isPlainObject(next)) return next ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(next)) {
    out[key] = deepMerge(base[key], value);
  }
  return out;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function usage() {
  return `Usage:
  resume-claw doctor
  resume-claw run --resume /path/to/resume.pdf [--target-role "Product Manager"] [--location "San Francisco, CA"] [--out runs/demo]

Options:
  --model <name>        Ollama model override. Default from resume-claw.config.json.
  --skip-web            Use model analysis with no live web corpus.
  --serial              Run claws sequentially instead of parallel.
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

async function doctor(config) {
  const checks = [];
  checks.push(['node', process.version]);
  checks.push(['openclaw', commandExists('openclaw') ? run('openclaw', ['--version']).trim() : 'missing']);
  checks.push(['ollama', commandExists('ollama') ? run('ollama', ['--version']).trim() : 'missing']);
  checks.push(['pdftotext', commandExists('pdftotext') ?? 'missing']);
  checks.push(['chromium', commandExists('chromium') ?? commandExists('google-chrome') ?? 'missing']);

  let ollamaModels = [];
  try {
    const tags = await fetchJson(`${config.ollamaHost}/api/tags`, {}, 8000);
    ollamaModels = (tags.models ?? []).map((model) => model.name);
  } catch (error) {
    checks.push(['ollama-api', `error: ${error.message}`]);
  }

  for (const [name, value] of checks) {
    console.log(`${name}: ${value}`);
  }
  console.log(`configured model: ${config.model}`);
  console.log(`model installed: ${ollamaModels.includes(config.model) ? 'yes' : 'no'}`);
}

async function extractResume(filePath) {
  const absolute = path.resolve(filePath);
  if (!existsSync(absolute)) throw new Error(`Resume not found: ${absolute}`);
  const ext = path.extname(absolute).toLowerCase();
  if (ext === '.pdf') {
    if (commandExists('pdftotext')) {
      return run('pdftotext', ['-layout', absolute, '-'], { timeout: 120000 }).trim();
    }
    throw new Error('PDF input requires pdftotext on PATH.');
  }
  return (await fs.readFile(absolute, 'utf8')).trim();
}

async function inferTarget(config, resumeText) {
  const prompt = await loadPrompt(config.claws.target);
  const payload = {
    resumeText: truncate(resumeText, 14000),
  };
  return callOllamaJson(config, [
    { role: 'system', content: `${prompt}\nReturn only valid JSON.` },
    { role: 'user', content: `/no_think\n${JSON.stringify(payload)}` },
  ], { label: 'target-infer', maxTokens: 512 });
}

async function runDemo(config, args) {
  if (!args.resume) throw new Error('Missing --resume');

  const model = args.model ?? config.model;
  const effectiveConfig = { ...config, model };
  const resumeText = await extractResume(args.resume);
  if (!resumeText || resumeText.length < 100) {
    throw new Error('Resume extraction produced too little text. Try a text-based PDF or .md/.txt file.');
  }

  let targetRole = args['target-role'];
  let location = args.location;
  let targetInference = null;
  if (!targetRole || !location) {
    targetInference = await inferTarget(effectiveConfig, resumeText);
    targetRole = targetRole || targetInference.targetRole || 'Software Engineer';
    location = location || targetInference.location || 'United States';
  }

  const slug = slugify(`${targetRole}-${location}`);
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'runs', `${timestamp()}-${slug}`));
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'input-resume.txt'), `${resumeText}\n`);
  if (targetInference) {
    await writeJson(path.join(outDir, 'target-inference.json'), targetInference);
  }

  console.log(`Target role: ${targetRole}`);
  console.log(`Location: ${location}`);
  console.log(`Output: ${outDir}`);

  const jobCorpus = args['skip-web'] ? [] : await collectJobCorpus(effectiveConfig, targetRole, location);
  const salaryCorpus = args['skip-web'] ? [] : await collectSalaryCorpus(effectiveConfig, targetRole, location);
  await writeJson(path.join(outDir, 'job-corpus.json'), jobCorpus);
  await writeJson(path.join(outDir, 'salary-corpus.json'), salaryCorpus);

  const jobMarketPrompt = await loadPrompt(effectiveConfig.claws.jobMarket);
  const resumeGapPrompt = await loadPrompt(effectiveConfig.claws.resumeGap);
  const salaryPrompt = await loadPrompt(effectiveConfig.claws.salary);

  const jobPayload = { targetRole, location, sources: jobCorpus };
  const gapPayload = {
    targetRole,
    location,
    resumeText: truncate(resumeText, 22000),
    jobSources: jobCorpus,
  };
  const salaryPayload = { targetRole, location, sources: salaryCorpus };

  console.log('Running specialist claws...');
  const runSpecialists = [
    () => runClaw(effectiveConfig, 'job-market', jobMarketPrompt, jobPayload),
    () => runClaw(effectiveConfig, 'resume-gap', resumeGapPrompt, gapPayload),
    () => runClaw(effectiveConfig, 'salary', salaryPrompt, salaryPayload),
  ];

  const [jobMarket, resumeGap, salary] = args.serial || effectiveConfig.parallelClaws === false
    ? await runSequential(runSpecialists)
    : await Promise.all(runSpecialists.map((fn) => fn()));

  await writeJson(path.join(outDir, 'job-market.json'), jobMarket);
  await writeJson(path.join(outDir, 'resume-gap.json'), resumeGap);
  await writeJson(path.join(outDir, 'salary.json'), salary);

  console.log('Running lead claw...');
  const leadPrompt = await loadPrompt(effectiveConfig.claws.lead);
  const lead = await runClaw(effectiveConfig, 'lead', leadPrompt, {
    targetRole,
    location,
    originalResume: truncate(resumeText, 18000),
    jobMarket,
    resumeGap,
    salary,
  }, { maxTokens: 7000 });

  const evidenceGuardPrompt = await loadPrompt(effectiveConfig.claws.evidenceGuard);
  const evidenceGuard = await runClaw(effectiveConfig, 'evidence-guard', evidenceGuardPrompt, {
    originalResume: truncate(resumeText, 18000),
    generatedResumeMarkdown: lead.upgradedResumeMarkdown ?? '',
    generatedLead: lead,
  }, { maxTokens: 7000 });
  if (evidenceGuard.upgradedResumeMarkdown) {
    lead.upgradedResumeMarkdown = sanitizeResumeMarkdown(
      evidenceGuard.upgradedResumeMarkdown,
      resumeText,
    );
    lead.evidenceGuard = {
      unsupportedClaims: evidenceGuard.unsupportedClaims ?? [],
      editsMade: evidenceGuard.editsMade ?? [],
    };
  } else if (lead.upgradedResumeMarkdown) {
    lead.upgradedResumeMarkdown = sanitizeResumeMarkdown(lead.upgradedResumeMarkdown, resumeText);
  }

  await writeJson(path.join(outDir, 'lead.json'), lead);
  if (lead.evidenceGuard) await writeJson(path.join(outDir, 'evidence-guard.json'), lead.evidenceGuard);
  await writeMarkdownOutputs(outDir, {
    targetRole,
    location,
    lead,
    jobMarket,
    resumeGap,
    salary,
  });

  console.log(`Done: ${path.join(outDir, 'index.html')}`);
}

async function runSequential(tasks) {
  const out = [];
  for (const task of tasks) out.push(await task());
  return out;
}

async function runClaw(config, name, systemPrompt, payload, options = {}) {
  const messages = [
    {
      role: 'system',
      content: `${systemPrompt}\nReturn only valid JSON. Do not wrap it in Markdown. Do not include commentary outside JSON.`,
    },
    {
      role: 'user',
      content: `/no_think\n${JSON.stringify(payload)}`,
    },
  ];
  const result = await callOllamaJson(config, messages, {
    label: name,
    maxTokens: options.maxTokens ?? config.maxOutputTokens,
  });
  return result;
}

async function callOllamaJson(config, messages, options = {}) {
  const body = {
    model: config.model,
    messages,
    stream: false,
    think: false,
    format: 'json',
    options: {
      temperature: config.temperature,
      num_ctx: config.contextTokens,
      num_predict: options.maxTokens ?? config.maxOutputTokens,
    },
  };
  const response = await fetchJson(`${config.ollamaHost}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, options.timeout ?? 900000);
  const content = response?.message?.content ?? response?.response ?? '';
  const parsed = tryParseJson(content);
  if (parsed.ok) return parsed.value;

  const repaired = await repairJson(config, content, options.label ?? 'unknown');
  const repairedParsed = tryParseJson(repaired);
  if (repairedParsed.ok) return repairedParsed.value;

  throw new Error(`Claw ${options.label ?? 'unknown'} returned non-JSON: ${content.slice(0, 500)}`);
}

function tryParseJson(content) {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (directError) {
    const extracted = extractJsonObject(content);
    if (!extracted) return { ok: false, error: directError };
    try {
      return { ok: true, value: JSON.parse(extracted) };
    } catch (extractError) {
      return { ok: false, error: extractError };
    }
  }
}

async function repairJson(config, malformed, label) {
  const body = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content: 'You repair malformed JSON. Return only valid JSON. Preserve all keys and meaning. Do not add commentary.',
      },
      {
        role: 'user',
        content: `/no_think\nRepair this malformed JSON from ${label}:\n\n${truncate(malformed, 14000)}`,
      },
    ],
    stream: false,
    think: false,
    format: 'json',
    options: {
      temperature: 0,
      num_ctx: Math.min(config.contextTokens, 16384),
      num_predict: config.maxOutputTokens,
    },
  };
  const response = await fetchJson(`${config.ollamaHost}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 300000);
  return response?.message?.content ?? response?.response ?? '';
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

async function collectJobCorpus(config, targetRole, location) {
  const queries = [
    `${targetRole} ${location} job posting responsibilities requirements`,
    `site:greenhouse.io ${targetRole} ${location} requirements`,
    `site:lever.co ${targetRole} ${location} qualifications`,
    `site:jobs.ashbyhq.com ${targetRole} ${location}`,
    `"${targetRole}" "${location}" "What you will do" "Qualifications"`,
  ];
  return collectSearchCorpus(config, queries, config.search.maxJobResults);
}

async function collectSalaryCorpus(config, targetRole, location) {
  const queries = [
    `${targetRole} ${location} salary range 2026`,
    `site:levels.fyi ${targetRole} ${location} salary`,
    `site:salary.com ${targetRole} ${location} salary`,
    `site:bls.gov ${targetRole} ${location} wage`,
  ];
  return collectSearchCorpus(config, queries, config.search.maxSalaryResults);
}

async function collectSearchCorpus(config, queries, maxResults) {
  const seen = new Set();
  const results = [];
  for (const query of queries) {
    if (results.length >= maxResults) break;
    const hits = await duckDuckGo(query).catch(() => []);
    for (const hit of hits) {
      if (!hit.url || seen.has(hit.url)) continue;
      seen.add(hit.url);
      results.push({ ...hit, query });
      if (results.length >= maxResults) break;
    }
  }

  if (!config.search.fetchPages) return results;

  const enriched = [];
  for (const result of results) {
    const pageText = await fetchPageText(result.url, config.search.pageChars).catch((error) => `FETCH_FAILED: ${error.message}`);
    enriched.push({ ...result, pageText });
  }
  return enriched;
}

async function duckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url, 12000);
  const chunks = html.split(/<div class="result results_links/gi).slice(1, 8);
  const hits = [];
  for (const chunk of chunks) {
    const titleMatch = chunk.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const snippetMatch = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const urlValue = decodeDuckUrl(htmlDecode(titleMatch[1]));
    hits.push({
      title: cleanText(titleMatch[2]),
      url: urlValue,
      snippet: cleanText(snippetMatch?.[1] ?? snippetMatch?.[2] ?? ''),
    });
  }
  return hits;
}

function decodeDuckUrl(value) {
  try {
    const parsed = new URL(value, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : parsed.href;
  } catch {
    return value;
  }
}

async function fetchPageText(url, maxChars) {
  const html = await fetchText(url, 10000);
  return truncate(stripHtml(html), maxChars);
}

async function fetchText(url, timeoutMs) {
  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 OpenClawResumeDemo/0.1',
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    },
  }, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url, options, timeoutMs) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html) {
  return cleanText(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function cleanText(text) {
  return htmlDecode(String(text ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlDecode(text) {
  return String(text ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function loadPrompt(relativePath) {
  return fs.readFile(path.resolve(ROOT, relativePath), 'utf8');
}

function truncate(text, maxChars) {
  const value = String(text ?? '');
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[TRUNCATED ${value.length - maxChars} CHARS]`;
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeMarkdownOutputs(outDir, data) {
  const diagnosis = formatDiagnosis(data);
  const roles = formatRoles(data.lead.topCompetitiveRoles ?? []);
  const resume = data.lead.upgradedResumeMarkdown || fallbackResume(data);
  const report = formatReport(data, diagnosis, roles);
  const resumeHtml = markdownPage('Upgraded Resume', resume);
  const reportHtml = markdownPage('Resume Callback Demo', report);

  await fs.writeFile(path.join(outDir, 'why-no-callbacks.md'), diagnosis);
  await fs.writeFile(path.join(outDir, 'top-roles.md'), roles);
  await fs.writeFile(path.join(outDir, 'upgraded-resume.md'), `${resume.trim()}\n`);
  await fs.writeFile(path.join(outDir, 'upgraded-resume.html'), resumeHtml);
  await fs.writeFile(path.join(outDir, 'index.html'), reportHtml);

  await maybeRenderPdf(outDir);
}

function formatDiagnosis({ lead, resumeGap }) {
  const items = lead.plainEnglishDiagnosis ?? resumeGap.whyNoCallbacks ?? [];
  const lines = ['# Why you were not getting callbacks', ''];
  for (const item of items) {
    lines.push(`## ${item.issue ?? 'Callback blocker'}`);
    lines.push('');
    if (item.whyItMatters) lines.push(`Why it matters: ${item.whyItMatters}`);
    if (item.proof) lines.push(`Proof: ${item.proof}`);
    if (item.evidenceFromResume || item.evidenceFromMarket) {
      lines.push(`Proof: ${[item.evidenceFromResume, item.evidenceFromMarket].filter(Boolean).join(' | ')}`);
    }
    if (item.whyItHurts) lines.push(`Why it hurts: ${item.whyItHurts}`);
    if (item.fix) lines.push(`Fix: ${item.fix}`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

function formatRoles(roles) {
  const lines = ['# Top competitive roles right now', ''];
  roles.slice(0, 5).forEach((role, index) => {
    lines.push(`## ${index + 1}. ${role.title ?? 'Role'}`);
    lines.push('');
    lines.push(`Why competitive: ${role.whyCompetitive ?? 'Not specified.'}`);
    lines.push(`Remaining gap: ${role.remainingGap ?? 'Not specified.'}`);
    if (role.searchUrl) lines.push(`Link: ${role.searchUrl}`);
    if (role.confidence != null) lines.push(`Confidence: ${role.confidence}`);
    lines.push('');
  });
  return `${lines.join('\n').trim()}\n`;
}

function formatReport(data, diagnosis, roles) {
  const lines = [
    '# Resume Callback Demo',
    '',
    `Target role: ${data.targetRole}`,
    `Location: ${data.location}`,
    '',
    `Headline: ${data.lead.headline ?? 'Resume upgrade'}`,
    '',
    '## Salary snapshot',
    '',
    data.lead.salarySnapshot ?? JSON.stringify(data.salary.salaryRange ?? {}, null, 2),
    '',
    diagnosis.trim(),
    '',
    roles.trim(),
    '',
    '## Rewritten sections',
    '',
  ];

  const rewritten = data.lead.rewrittenSections ?? {};
  if (rewritten.summary) {
    lines.push('### Summary', '', rewritten.summary, '');
  }
  if (Array.isArray(rewritten.skills)) {
    lines.push('### Skills', '', rewritten.skills.map((skill) => `- ${skill}`).join('\n'), '');
  }
  if (Array.isArray(rewritten.experienceBullets)) {
    lines.push('### Bullet rewrites', '');
    for (const bullet of rewritten.experienceBullets) {
      lines.push(`Before: ${bullet.before ?? ''}`);
      lines.push(`After: ${bullet.after ?? ''}`);
      if (bullet.reason) lines.push(`Reason: ${bullet.reason}`);
      lines.push('');
    }
  }
  if (data.lead.demoTalkTrack) {
    lines.push('## Presenter talk track', '', data.lead.demoTalkTrack, '');
  }
  lines.push('## Downloads', '', '- [Upgraded resume](upgraded-resume.html)', '- [Markdown resume](upgraded-resume.md)', '- [Callback diagnosis](why-no-callbacks.md)', '- [Top roles](top-roles.md)', '');
  return `${lines.join('\n').trim()}\n`;
}

function fallbackResume({ lead }) {
  const rewritten = lead.rewrittenSections ?? {};
  return [
    '# Upgraded Resume',
    '',
    '## Summary',
    '',
    rewritten.summary ?? '',
    '',
    '## Skills',
    '',
    ...(rewritten.skills ?? []).map((skill) => `- ${skill}`),
    '',
    '## Experience Rewrites',
    '',
    ...(rewritten.experienceBullets ?? []).map((bullet) => `- ${bullet.after ?? bullet.before ?? ''}`),
  ].join('\n');
}

function sanitizeResumeMarkdown(markdown, originalResume) {
  let out = String(markdown ?? '');
  const originalLower = originalResume.toLowerCase();
  const hasCrmEvidence = originalLower.includes('crm');
  const unsupportedTools = ['salesforce', 'hubspot', 'gainsight', 'churnzero', 'totango'];
  for (const tool of unsupportedTools) {
    if (!originalLower.includes(tool)) {
      const label = tool[0].toUpperCase() + tool.slice(1);
      out = out.replace(new RegExp(label, 'g'), `[add ${label} if true]`);
    }
  }
  if (!hasCrmEvidence) {
    out = out
      .replace(/\bCRM data\b/g, 'customer data [add CRM if true]')
      .replace(/\bCRM systems\b/g, 'customer systems [add CRM if true]')
      .replace(/\bCRM \([^)]*\)/g, 'CRM ([add CRM if true])')
      .replace(/\[add \[add Salesforce if true\]\/HubSpot if true\]/g, 'CRM ([add CRM if true])')
      .replace(/\[add Salesforce if true\]\/HubSpot if true/g, 'CRM ([add CRM if true])')
      .replace(/\bCRM Proficiency\s*CRM \(\[add CRM if true\]\)/g, 'CRM ([add CRM if true])')
      .replace(/\bCRM Proficiency\b/g, 'CRM ([add CRM if true])');
  }
  out = out
    .replace(/\[add \[add ([^\]]+) if true\] if true\]/g, '[add $1 if true]')
    .replace(/\[add \[add ([^\]]+) if true\] if available\]/g, '[add $1 if available]');
  out = out
    .replace(/\bProven ability to\b/g, 'Experience')
    .replace(/\bProven track record of\b/g, 'Experience with')
    .replace(/\bExpert in\b/g, 'Experienced in')
    .replace(/\bstrategic account portfolios\b/gi, 'customer accounts [add portfolio size if true]')
    .replace(/\bNegotiated and secured renewals\b/g, 'Supported renewal workflows')
    .replace(/\bRevenue Expansion\b/g, 'Revenue Expansion [verify if true]');
  if (!originalLower.includes('health')) {
    out = out.replace(/\bCustomer Health Monitoring\b/g, 'Customer Health Monitoring [add if true]');
  }
  if (!originalLower.includes('automation') && !originalLower.includes('automated')) {
    out = out.replace(/\bProcess Automation\b/g, 'Process Improvement');
  }
  return out;
}

function markdownPage(title, markdown) {
  const body = markdownToHtml(markdown);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; --ink:#1c1f23; --muted:#5b6470; --line:#d8dde5; --accent:#0f766e; --paper:#ffffff; --bg:#f6f7f9; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  main { max-width:920px; margin:0 auto; padding:42px 24px 64px; background:var(--paper); min-height:100vh; }
  h1 { font-size:34px; line-height:1.1; margin:0 0 22px; }
  h2 { font-size:22px; margin:34px 0 10px; padding-top:18px; border-top:1px solid var(--line); }
  h3 { font-size:17px; margin:24px 0 8px; color:var(--accent); }
  p { margin:0 0 12px; }
  ul { padding-left:22px; }
  li { margin:4px 0; }
  a { color:var(--accent); }
  code { background:#eef2f6; padding:2px 5px; border-radius:4px; }
  @media print { body { background:white; } main { padding:0; max-width:none; } a { color:inherit; } }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let inList = false;
  for (const line of lines) {
    if (line.startsWith('# ')) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h1>${inlineMd(line.slice(2))}</h1>`);
    } else if (line.startsWith('## ')) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
    } else if (line.startsWith('### ')) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h3>${inlineMd(line.slice(4))}</h3>`);
    } else if (line.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMd(line.slice(2))}</li>`);
    } else if (!line.trim()) {
      if (inList) { out.push('</ul>'); inList = false; }
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function inlineMd(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function maybeRenderPdf(outDir) {
  const chromium = commandExists('chromium') ?? commandExists('google-chrome');
  if (!chromium) return;
  const html = path.join(outDir, 'upgraded-resume.html');
  const pdf = path.join(outDir, 'upgraded-resume.pdf');
  const result = spawnSync(chromium, ['--headless', '--no-sandbox', `--print-to-pdf=${pdf}`, `file://${html}`], {
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.status !== 0) {
    await fs.writeFile(path.join(outDir, 'pdf-render.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'resume';
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
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
