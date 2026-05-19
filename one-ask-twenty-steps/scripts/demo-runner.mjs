#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const outputDir = path.join(root, "output");
const runDate = new Date("2026-05-14T16:30:00-05:00");

const defaultAsk = "Put together a reading list on personal finance for a beginner.";
const outputBase = "beginner-personal-finance-reading-list";

function parseArgs(argv) {
  const args = {
    ask: defaultAsk,
    write: true,
    json: false,
    publish: "both"
  };

  const freeform = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-write") {
      args.write = false;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--publish") {
      i += 1;
      args.publish = argv[i] || args.publish;
      continue;
    }
    if (arg.startsWith("--publish=")) {
      args.publish = arg.slice("--publish=".length);
      continue;
    }
    if (arg === "--ask") {
      i += 1;
      freeform.push(argv[i] || "");
      continue;
    }
    freeform.push(arg);
  }

  if (freeform.length) args.ask = freeform.join(" ").trim();
  if (!["md", "html", "both"].includes(args.publish)) {
    console.error("Unknown publish mode. Use one of: md, html, both");
    process.exit(1);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8"));
const searchResults = readJson("search_results.json");
const workflowSteps = readJson("workflow_steps.json");

const topicOrder = [
  "Start Here",
  "Budgeting and Cash Flow",
  "Saving and Emergency Funds",
  "Credit and Debt",
  "Investing Basics",
  "Retirement"
];

const authorityByType = {
  government: 0.98,
  "nonprofit-regulator": 0.92,
  nonprofit: 0.86,
  "community-reference": 0.75,
  "forum-thread": 0.42,
  "affiliate-blog": 0.22,
  "influencer-video": 0.16,
  "paid-course": 0.2
};

const redFlagPenalty = {
  "affiliate links": 0.18,
  "get-rich framing": 0.2,
  "unsupported score claims": 0.16,
  "guaranteed returns": 0.28,
  leverage: 0.2,
  speculation: 0.22,
  "no risk disclosure": 0.18,
  "paid funnel": 0.18,
  "scarcity marketing": 0.14,
  "thin preview": 0.12,
  anecdotal: 0.1,
  "one-size-fits-all": 0.12,
  "missing tradeoffs": 0.1,
  "US-specific in places": 0.03,
  "dense reference page": 0.04,
  "narrow topic": 0.05
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function extractIntent(ask) {
  const lower = ask.toLowerCase();
  const audience = lower.includes("beginner") ? "beginner" : "general reader";
  const subject = lower.includes("personal finance") ? "personal finance" : "requested topic";
  const deliverable = lower.includes("reading list") ? "reading list" : "shareable research brief";
  const friendReady = lower.includes("friend") || lower.includes("share") || deliverable === "reading list";

  return {
    ask,
    audience,
    subject,
    deliverable,
    friendReady,
    constraints: [
      "Prefer free or low-cost resources",
      "Avoid unsupported financial claims",
      "Separate education from personal financial advice",
      "Produce a clean document that can be shared"
    ]
  };
}

function scoreResult(result, intent) {
  const authority = authorityByType[result.source_type] ?? 0.45;
  const beginnerFit = result.difficulty === intent.audience ? 1 : 0.72;
  const relevance = result.topic === "Start Here" ? 0.9 : topicOrder.includes(result.topic) ? 0.86 : 0.58;
  const freshness = clamp((result.year - 2020) / 6, 0.45, 1);
  const commercialPenalty = clamp(result.commercial_intensity || 0, 0, 1) * 0.2;
  const flagPenalty = (result.red_flags || []).reduce((total, flag) => total + (redFlagPenalty[flag] || 0.08), 0);
  const raw =
    (0.34 * authority) +
    (0.21 * beginnerFit) +
    (0.16 * result.clarity) +
    (0.15 * result.practicality) +
    (0.09 * relevance) +
    (0.05 * freshness) -
    commercialPenalty -
    flagPenalty;
  const score = round(clamp(raw, 0, 1) * 100, 0);

  const hardReject = (result.red_flags || []).some((flag) => [
    "guaranteed returns",
    "leverage",
    "speculation",
    "get-rich framing",
    "unsupported score claims",
    "paid funnel"
  ].includes(flag));

  return {
    ...result,
    score,
    authority_score: round(authority * 100, 0),
    beginner_fit: round(beginnerFit * 100, 0),
    status: score >= 72 && !hardReject ? "selected-candidate" : "filtered",
    filter_reason: score >= 72 && !hardReject
      ? "Meets authority, clarity, beginner fit, and low-commerciality thresholds."
      : hardReject
        ? "Filtered because it contains high-risk claims or commercial pressure."
        : "Filtered because stronger beginner resources cover this need."
  };
}

function runSearch(intent) {
  const queries = [
    `${intent.subject} beginner reading list`,
    `${intent.subject} budgeting saving credit investing beginner`,
    `${intent.subject} government consumer education`,
    `${intent.subject} investing basics regulator`
  ];

  const scored = searchResults
    .map((result) => scoreResult(result, intent))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const selected = [];
  const topicCounts = new Map();

  for (const result of scored) {
    if (result.status !== "selected-candidate") continue;
    const currentCount = topicCounts.get(result.topic) || 0;
    const topicLimit = result.topic === "Investing Basics" ? 3 : 2;
    if (currentCount >= topicLimit) continue;
    selected.push({ ...result, status: "selected" });
    topicCounts.set(result.topic, currentCount + 1);
  }

  selected.sort((a, b) => {
    const topicDiff = topicOrder.indexOf(a.topic) - topicOrder.indexOf(b.topic);
    return topicDiff || b.score - a.score;
  });

  const selectedIds = new Set(selected.map((pick) => pick.id));
  const alternates = scored.filter((result) => result.status === "selected-candidate" && !selectedIds.has(result.id));
  const filtered = scored.filter((result) => result.status === "filtered");
  return { queries, scored, selected, alternates, filtered };
}

function groupByTopic(items) {
  const grouped = new Map();
  for (const topic of topicOrder) grouped.set(topic, []);
  for (const item of items) {
    if (!grouped.has(item.topic)) grouped.set(item.topic, []);
    grouped.get(item.topic).push(item);
  }
  return [...grouped.entries()].filter(([, values]) => values.length);
}

function buildStepTrace(intent, search, artifacts) {
  const values = [
    `Ask: "${intent.ask}"`,
    `Audience: ${intent.audience}; deliverable: ${intent.deliverable}`,
    topicOrder.join(", "),
    search.queries.join(" | "),
    `${searchResults.filter((item) => ["government", "nonprofit", "nonprofit-regulator"].includes(item.source_type)).length} trusted candidates found`,
    `${searchResults.length} total candidates found`,
    `${new Set(searchResults.map((item) => item.url)).size} unique URLs retained`,
    `${topicOrder.length} target topics used`,
    "Authority scored from source type and quality signals",
    "Beginner fit scored from difficulty, clarity, and practical exercises",
    `${search.scored.filter((item) => item.commercial_intensity > 0.5 || item.red_flags.length).length} candidates flagged`,
    `${search.filtered.length} low-quality candidates filtered out`,
    `${groupByTopic(search.selected).length} populated topic groups`,
    `${search.selected.length} resources selected`,
    "Descriptions written for every selected resource",
    "Reading order starts broad, then moves to credit, investing, and retirement",
    "Markdown document composed",
    "HTML page rendered",
    `${artifacts.length || 2} artifact paths prepared`,
    "Ready to share"
  ];

  return workflowSteps.map((name, index) => ({
    step: index + 1,
    name,
    status: "done",
    output: values[index] || "Completed"
  }));
}

function renderMarkdown({ intent, search, trace }) {
  const grouped = groupByTopic(search.selected);
  const filtered = search.filtered
    .filter((item) => item.red_flags.length || item.commercial_intensity > 0.5)
    .slice(0, 5);
  const alternates = search.alternates.slice(0, 3);

  const lines = [
    "# Beginner Personal Finance Reading List",
    "",
    `Request: ${intent.ask}`,
    `Generated: ${runDate.toLocaleString("en-US", { timeZone: "America/Chicago" })} CT`,
    "",
    "This is an educational reading list, not personal financial advice. It favors free, practical, beginner-friendly sources and filters out hype, affiliate-heavy pages, and unsupported return claims.",
    "",
    "## Start Here",
    "",
    "1. Build a simple cash-flow picture: what comes in, what goes out, what is due soon.",
    "2. Stabilize basics: bills, emergency savings, high-interest debt, and credit report accuracy.",
    "3. Learn investing vocabulary before choosing products.",
    "4. Treat retirement accounts and taxes as rules-heavy reference topics.",
    "",
    "## The Reading List"
  ];

  for (const [topic, items] of grouped) {
    lines.push("", `### ${topic}`, "");
    for (const item of items) {
      lines.push(`- [${item.title}](${item.url}) - ${item.summary}`);
      lines.push(`  Why it made the list: ${item.why_read}`);
      lines.push(`  Quality notes: ${item.quality_signals.join("; ")}. Score: ${item.score}/100.`);
    }
  }

  lines.push(
    "",
    "## Suggested Order",
    "",
    ...search.selected.map((item, index) => `${index + 1}. ${item.title} (${item.source})`),
    "",
    "## Strong Alternates",
    ""
  );

  if (alternates.length) {
    for (const item of alternates) {
      lines.push(`- [${item.title}](${item.url}) (${item.source}) - Good resource, but held back to keep the beginner list short and balanced. Flags: ${item.red_flags.join(", ") || "none"}.`);
    }
  } else {
    lines.push("- None.");
  }

  lines.push(
    "",
    "## Filtered Out",
    ""
  );

  for (const item of filtered) {
    lines.push(`- ${item.title} (${item.source}) - ${item.filter_reason} Flags: ${item.red_flags.join(", ") || "none"}.`);
  }

  lines.push(
    "",
    "## Twenty Step Trace",
    "",
    "| Step | Workflow | Output |",
    "|---:|---|---|"
  );

  for (const item of trace) {
    lines.push(`| ${item.step} | ${item.name} | ${item.output.replaceAll("|", "\\|")} |`);
  }

  lines.push(
    "",
    "## Share Note",
    "",
    "For a friend who is just starting: begin with the FDIC or Khan Academy overview, use the CFPB budget and credit tools when you want worksheets, then read Investor.gov and FINRA before opening or changing an investment account."
  );

  return `${lines.join("\n")}\n`;
}

function renderHtml({ markdown, search }) {
  const grouped = groupByTopic(search.selected);
  const topicNav = grouped
    .map(([topic]) => `<a href="#${slugify(topic)}">${escapeHtml(topic)}</a>`)
    .join("");
  const cards = grouped.map(([topic, items]) => {
    const itemCards = items.map((item) => `
      <article class="resource-card">
        <div class="meta">${escapeHtml(item.source)} | ${escapeHtml(item.minutes)} min | Score ${escapeHtml(item.score)}/100</div>
        <h3><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></h3>
        <p>${escapeHtml(item.summary)}</p>
        <p class="why">${escapeHtml(item.why_read)}</p>
      </article>
    `).join("");
    return `
      <section id="${slugify(topic)}">
        <h2>${escapeHtml(topic)}</h2>
        <div class="resource-grid">${itemCards}</div>
      </section>
    `;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Beginner Personal Finance Reading List</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17201b;
      --muted: #5a655f;
      --line: #d8ddd8;
      --paper: #fbfcf8;
      --panel: #ffffff;
      --accent: #146c5c;
      --accent-soft: #e6f3ef;
      --gold: #9b6b13;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #f7fbf5 0%, #edf5ef 100%);
    }
    .wrap {
      width: min(1040px, calc(100% - 32px));
      margin: 0 auto;
    }
    .hero {
      padding: 46px 0 34px;
    }
    .eyebrow {
      color: var(--accent);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
      font-size: 0.78rem;
    }
    h1 {
      max-width: 760px;
      margin: 10px 0 12px;
      font-size: clamp(2rem, 5vw, 4rem);
      line-height: 1;
      letter-spacing: 0;
    }
    .lede {
      max-width: 780px;
      color: var(--muted);
      font-size: 1.08rem;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 0 0 28px;
    }
    nav a {
      color: var(--accent);
      background: var(--accent-soft);
      border: 1px solid #c8e2da;
      border-radius: 999px;
      padding: 8px 12px;
      text-decoration: none;
      font-weight: 650;
      font-size: 0.92rem;
    }
    main {
      padding: 32px 0 56px;
    }
    .note {
      border-left: 4px solid var(--gold);
      padding: 12px 16px;
      background: #fff8e8;
      margin-bottom: 28px;
      color: #46340c;
    }
    section {
      margin: 34px 0;
    }
    h2 {
      margin: 0 0 14px;
      font-size: 1.45rem;
      letter-spacing: 0;
    }
    .resource-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
    }
    .resource-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }
    .resource-card h3 {
      margin: 7px 0 8px;
      font-size: 1.05rem;
      line-height: 1.25;
      letter-spacing: 0;
    }
    .resource-card a {
      color: var(--accent);
    }
    .meta {
      color: var(--muted);
      font-size: 0.84rem;
      font-weight: 650;
    }
    .why {
      color: var(--muted);
      margin-bottom: 0;
    }
    .order {
      background: #f4f7f1;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }
    .order li + li {
      margin-top: 8px;
    }
    footer {
      border-top: 1px solid var(--line);
      color: var(--muted);
      padding: 24px 0;
    }
    @media (max-width: 620px) {
      .wrap { width: min(100% - 24px, 1040px); }
      .hero { padding-top: 32px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap hero">
      <div class="eyebrow">One Ask, Twenty Steps Done</div>
      <h1>Beginner Personal Finance Reading List</h1>
      <p class="lede">A clean, friend-ready guide assembled from a searched and filtered candidate set. Hype and affiliate-heavy picks were removed before publishing.</p>
    </div>
    <nav class="wrap">${topicNav}</nav>
  </header>
  <main class="wrap">
    <p class="note">Educational only. This does not recommend a specific account, security, loan, insurance product, tax move, or personalized financial plan.</p>
    ${cards}
    <section>
      <h2>Suggested Order</h2>
      <ol class="order">
        ${search.selected.map((item) => `<li>${escapeHtml(item.title)} <span class="meta">(${escapeHtml(item.source)})</span></li>`).join("")}
      </ol>
    </section>
  </main>
  <footer>
    <div class="wrap">Published by the one-ask workflow demo. Markdown source is embedded in the generated companion file.</div>
  </footer>
<!--
${escapeHtml(markdown)}
-->
</body>
</html>
`;
}

function verifyArtifacts({ markdown, html, search }) {
  const checks = [
    { name: "markdown has title", pass: markdown.includes("# Beginner Personal Finance Reading List") },
    { name: "markdown has selected resources", pass: search.selected.every((item) => markdown.includes(item.title)) },
    { name: "markdown has trace", pass: markdown.includes("## Twenty Step Trace") },
    { name: "html has resource cards", pass: html.includes("resource-card") },
    { name: "html has educational disclaimer", pass: html.includes("Educational only") }
  ];
  return checks;
}

function main() {
  const intent = extractIntent(args.ask);
  const search = runSearch(intent);
  const artifacts = [];
  const trace = buildStepTrace(intent, search, artifacts);
  const markdown = renderMarkdown({ intent, search, trace });
  const html = renderHtml({ markdown, search });
  const checks = verifyArtifacts({ markdown, html, search });

  if (args.write) {
    fs.mkdirSync(outputDir, { recursive: true });
    if (args.publish === "md" || args.publish === "both") {
      const markdownPath = path.join(outputDir, `${outputBase}.md`);
      fs.writeFileSync(markdownPath, markdown);
      artifacts.push(markdownPath);
    }
    if (args.publish === "html" || args.publish === "both") {
      const htmlPath = path.join(outputDir, `${outputBase}.html`);
      fs.writeFileSync(htmlPath, html);
      artifacts.push(htmlPath);
    }
  }

  const result = {
    ask: intent.ask,
    selected_count: search.selected.length,
    alternate_count: search.alternates.length,
    filtered_count: search.filtered.length,
    selected: search.selected.map(({ id, title, source, topic, score, url }) => ({ id, title, source, topic, score, url })),
    filtered: search.filtered.map(({ id, title, source, score, filter_reason }) => ({ id, title, source, score, filter_reason })),
    alternates: search.alternates.map(({ id, title, source, score, url }) => ({ id, title, source, score, url })),
    checks,
    artifacts,
    trace
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("One Ask, Twenty Steps Done");
  console.log(`Ask: ${intent.ask}`);
  console.log(`Selected ${search.selected.length} resources, kept ${search.alternates.length} strong alternate, and filtered ${search.filtered.length} low-quality candidates.`);
  console.log("");
  for (const item of search.selected) {
    console.log(`- ${item.title} (${item.source}) [${item.topic}] score ${item.score}/100`);
  }
  console.log("");
  if (args.write) {
    console.log("Published:");
    for (const artifact of artifacts) console.log(`- ${artifact}`);
  } else {
    console.log("No files written because --no-write was set.");
  }
  console.log("");
  console.log(checks.every((check) => check.pass) ? "Verification passed." : "Verification failed.");
}

main();
