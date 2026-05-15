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
  model: 'qwen3.6:35b-a3b',
  ollamaHost: 'http://127.0.0.1:11434',
  temperature: 0.35,
  maxOutputTokens: 2048,
};

function parseArgs(argv) {
  const args = { _: [], csv: [] };
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
    if (key === 'csv') {
      args.csv.push(argv[i + 1]);
      i += 1;
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
  spending-autopsy doctor
  spending-autopsy run --csv /path/to/export.csv [--csv another.csv] [--household "Avery"] [--location "San Francisco, CA"] [--out runs/demo]

Options:
  --skip-model          Use deterministic narration instead of calling Ollama.
  --model <name>        Ollama model override. Default from demo.config.json.
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
  checks.push(['python3', commandExists('python3') ?? 'missing']);
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

async function runDemo(config, args) {
  if (!args.csv.length) throw new Error('Missing --csv');

  const model = args.model ?? config.model;
  const effectiveConfig = { ...config, model };
  const household = args.household ?? config.sample?.household ?? 'Household';
  const location = args.location ?? config.sample?.location ?? 'United States';
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'runs', `${timestamp()}-${slugify(household)}-spending-autopsy`));
  await fs.mkdir(outDir, { recursive: true });

  console.log(`Household: ${household}`);
  console.log(`Location: ${location}`);
  console.log(`Output: ${outDir}`);

  const rawRows = [];
  for (const csvPath of args.csv) {
    const absolute = path.resolve(csvPath);
    const rows = await readCsvFile(absolute);
    rawRows.push(...rows.map((row) => ({ ...row, __source: absolute })));
  }

  const cleaned = cleanTransactions(rawRows);
  const categorized = categorizeTransactions(cleaned.transactions);
  const analysis = analyzeSpending(categorized, cleaned.rejected);
  const narrative = args['skip-model']
    ? deterministicNarrative(household, location, analysis)
    : await narrateWithFallback(effectiveConfig, household, location, analysis);

  await writeJson(path.join(outDir, 'cleaned-transactions.json'), cleaned);
  await writeJson(path.join(outDir, 'categorized-transactions.json'), categorized);
  await writeJson(path.join(outDir, 'analysis.json'), analysis);
  await fs.writeFile(path.join(outDir, 'categorized-transactions.csv'), toCsv(categorized.map(transactionToCsvRow)));
  await fs.writeFile(path.join(outDir, 'spending-summary.md'), renderSummaryMarkdown(household, location, analysis, narrative));
  await fs.writeFile(path.join(outDir, 'anomalies.md'), renderAnomaliesMarkdown(analysis));
  await fs.writeFile(path.join(outDir, 'three-cuts.md'), renderCutsMarkdown(analysis));
  await fs.writeFile(path.join(outDir, 'index.html'), renderHtml(household, location, analysis, narrative, categorized));

  console.log(`Transactions parsed: ${rawRows.length}`);
  console.log(`Transactions kept: ${categorized.length}`);
  console.log(`Duplicates flagged: ${cleaned.duplicates.length}`);
  console.log(`Anomalies: ${analysis.anomalies.length}`);
  console.log(`Report: ${path.join(outDir, 'index.html')}`);
}

async function readCsvFile(filePath) {
  if (!existsSync(filePath)) throw new Error(`CSV not found: ${filePath}`);
  const raw = await fs.readFile(filePath, 'utf8');
  const rows = parseCsv(raw);
  if (rows.length < 2) throw new Error(`CSV has no data rows: ${filePath}`);
  const headers = rows[0].map((header) => normalizeHeader(header));
  return rows.slice(1)
    .filter((row) => row.some((value) => String(value).trim()))
    .map((row, index) => {
      const out = { __row: index + 2 };
      headers.forEach((header, i) => {
        out[header || `column_${i}`] = row[i] ?? '';
      });
      return out;
    });
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    const next = raw[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function cleanTransactions(rows) {
  const transactions = [];
  const rejected = [];
  const seen = new Map();
  const duplicates = [];

  for (const row of rows) {
    const date = parseDate(firstPresent(row, ['date', 'transaction_date', 'posted_date', 'posting_date', 'posted']));
    const description = firstPresent(row, ['description', 'details', 'merchant', 'name', 'memo', 'payee']);
    const amountInfo = parseAmount(row);

    if (!date || !description || amountInfo.amount == null) {
      rejected.push({ row, reason: 'missing date, description, or amount' });
      continue;
    }

    const normalizedMerchant = normalizeMerchant(description);
    const amount = roundMoney(amountInfo.amount);
    const expense = amount < 0 ? Math.abs(amount) : 0;
    const credit = amount > 0 ? amount : 0;
    const time = extractTime(description);
    const key = `${date}|${normalizedMerchant}|${amount.toFixed(2)}`;
    const duplicateOf = seen.get(key) ?? null;
    const transaction = {
      id: hash(`${key}|${row.__source}|${row.__row}`),
      date,
      month: date.slice(0, 7),
      originalDescription: description.trim(),
      normalizedMerchant,
      amount,
      expense,
      credit,
      type: amount < 0 ? 'expense' : 'credit',
      time,
      sourceFile: row.__source,
      sourceRow: row.__row,
      duplicate: Boolean(duplicateOf),
      duplicateOf,
    };
    if (duplicateOf) duplicates.push(transaction);
    else seen.set(key, transaction.id);
    transactions.push(transaction);
  }

  return { transactions, duplicates, rejected };
}

function firstPresent(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
  }
  return '';
}

function parseDate(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
  const us = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${pad2(us[1])}-${pad2(us[2])}`;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return null;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseAmount(row) {
  const amountRaw = firstPresent(row, ['amount', 'transaction_amount', 'value']);
  if (amountRaw) return { amount: parseMoney(amountRaw) };

  const debit = parseMoney(firstPresent(row, ['debit', 'withdrawal', 'withdrawals', 'charge']));
  const credit = parseMoney(firstPresent(row, ['credit', 'deposit', 'deposits', 'payment']));
  if (debit != null && debit !== 0) return { amount: -Math.abs(debit) };
  if (credit != null && credit !== 0) return { amount: Math.abs(credit) };
  return { amount: null };
}

function parseMoney(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const negative = /^\(.*\)$/.test(value) || value.startsWith('-');
  const cleaned = value.replace(/[()$,\s]/g, '').replace(/^\+/, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function normalizeMerchant(description) {
  return String(description)
    .toUpperCase()
    .replace(/\b\d{3}[-\s]?\d{3}[-\s]?\d{4}\b/g, ' ')
    .replace(/\b(POS|DEBIT|CARD|PURCHASE|RECURRING|CHECKCARD|ONLINE|PMNT|PAYMENT|AUTH|SQ|TST)\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\b[A-Z]{2}\s?\d{5}\b/g, ' ')
    .replace(/[#*:.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bSAN FRANCISCO\b|\bOAKLAND\b|\bCA\b|\bNY\b|\bWA\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTime(description) {
  const match = String(description).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!match) return null;
  return `${pad2(match[1])}:${match[2]}`;
}

function categorizeTransactions(transactions) {
  return transactions.map((transaction) => {
    if (transaction.type === 'credit') {
      return { ...transaction, category: 'Income and credits', subcategory: 'money in', behavior: 'not spending' };
    }

    const text = `${transaction.normalizedMerchant} ${transaction.originalDescription}`.toUpperCase();
    const hour = transaction.time ? Number(transaction.time.slice(0, 2)) : null;
    let category = 'Other spending';
    let subcategory = 'miscellaneous leakage';
    let behavior = 'unclear habit';

    const set = (nextCategory, nextSubcategory, nextBehavior) => {
      category = nextCategory;
      subcategory = nextSubcategory;
      behavior = nextBehavior;
    };

    if (matches(text, ['RENT', 'APARTMENTS', 'PROPERTY'])) set('Housing', 'rent', 'fixed cost');
    else if (matches(text, ['PAYROLL', 'DIRECT DEP', 'SALARY'])) set('Income and credits', 'paycheck', 'not spending');
    else if (matches(text, ['STARBUCKS', 'PEETS', 'PHILZ', 'BLUE BOTTLE', 'COFFEE'])) set('Coffee', 'coffee runs', 'daily convenience tax');
    else if (matches(text, ['DOORDASH', 'UBER EATS', 'GRUBHUB', 'TACO BELL', 'PIZZA', 'MCDONALD', 'SHAKE SHACK'])) {
      if (hour != null && (hour >= 21 || hour < 5)) set('Late-night food', 'tired delivery', 'late-night food');
      else set('Restaurants and delivery', 'delivery and takeout', 'convenience meals');
    } else if (matches(text, ['NETFLIX', 'HULU', 'SPOTIFY', 'ADOBE', 'ICLOUD', 'DROPBOX', 'CALM', 'NYTIMES', 'CLASSPASS', 'PEACOCK', 'PARAMOUNT'])) {
      set('Subscriptions', 'subscriptions you forgot about', 'quiet recurring charges');
    } else if (matches(text, ['AMAZON', 'TARGET', 'ETSY', 'SEPHORA', 'BEST BUY', 'APPLE.COM/BILL'])) {
      set('Impulse buys', 'checkout drift', 'impulse buys');
    } else if (matches(text, ['SAFEWAY', 'TRADER JOE', 'WHOLE FOODS', 'COSTCO', 'GROCERY'])) set('Groceries', 'food at home', 'planned food');
    else if (matches(text, ['UBER ', 'LYFT'])) set('Rideshare', 'rideshare', 'convenience transport');
    else if (matches(text, ['BART', 'MUNI', 'CLIPPER'])) set('Transport', 'public transit', 'transit');
    else if (matches(text, ['SHELL', 'CHEVRON', 'EXXON'])) set('Transport', 'gas', 'car spend');
    else if (matches(text, ['PG&E', 'COMCAST', 'AT&T', 'VERIZON', 'UTILITY'])) set('Bills and utilities', 'utilities', 'fixed cost');
    else if (matches(text, ['UNITED', 'DELTA', 'AIRBNB', 'HOTEL', 'SOUTHWEST'])) set('Travel', 'trips', 'travel');
    else if (matches(text, ['WALGREENS', 'CVS', 'KAISER', 'PHARMACY'])) set('Health and pharmacy', 'health', 'care spend');
    else if (matches(text, ['ATM FEE', 'OVERDRAFT', 'BANK FEE', 'SERVICE FEE'])) set('Fees', 'avoidable fees', 'bank friction');
    else if (matches(text, ['MYSTERY', 'TECH SUPPORT', 'SUPPORT CO', '855'])) set('Needs review', 'weird charge', 'suspicious or forgotten charge');

    return { ...transaction, category, subcategory, behavior };
  });
}

function matches(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function analyzeSpending(transactions, rejected) {
  const expenses = transactions.filter((tx) => tx.type === 'expense' && !tx.duplicate);
  const credits = transactions.filter((tx) => tx.type === 'credit' && !tx.duplicate);
  const months = [...new Set(transactions.map((tx) => tx.month))].sort();
  const totalSpend = sum(expenses.map((tx) => tx.expense));
  const totalCredits = sum(credits.map((tx) => tx.credit));
  const categoryTotals = groupTotals(expenses, 'category');
  const subcategoryTotals = groupTotals(expenses, 'subcategory');
  const monthlyTotals = groupTotals(expenses, 'month');
  const monthlyByCategory = groupMonthCategory(expenses);
  const merchantTotals = groupTotals(expenses, 'normalizedMerchant');
  const coffeeTotal = roundMoney(categoryTotals.Coffee ?? 0);
  const subscriptionTransactions = expenses.filter((tx) => tx.category === 'Subscriptions');
  const recurring = recurringMerchants(subscriptionTransactions);
  const anomalies = detectAnomalies(transactions, expenses, monthlyByCategory, merchantTotals, recurring);
  const cuts = recommendCuts(categoryTotals, subcategoryTotals, recurring, anomalies, coffeeTotal);

  return {
    months,
    transactionCount: transactions.length,
    rejectedCount: rejected.length,
    duplicateCount: transactions.filter((tx) => tx.duplicate).length,
    totalSpend: roundMoney(totalSpend),
    totalCredits: roundMoney(totalCredits),
    netCashFlow: roundMoney(totalCredits - totalSpend),
    categoryTotals: sortObjectByValue(categoryTotals),
    subcategoryTotals: sortObjectByValue(subcategoryTotals),
    monthlyTotals: sortObjectByKey(monthlyTotals),
    monthlyByCategory,
    topMerchants: Object.entries(sortObjectByValue(merchantTotals)).slice(0, 12).map(([merchant, amount]) => ({ merchant, amount })),
    recurring,
    anomalies,
    cuts,
    coffeeTotal,
  };
}

function groupTotals(items, key) {
  const out = {};
  for (const item of items) {
    const group = item[key] || 'Unknown';
    out[group] = roundMoney((out[group] ?? 0) + item.expense);
  }
  return out;
}

function groupMonthCategory(expenses) {
  const out = {};
  for (const tx of expenses) {
    out[tx.month] ??= {};
    out[tx.month][tx.category] = roundMoney((out[tx.month][tx.category] ?? 0) + tx.expense);
  }
  return out;
}

function recurringMerchants(transactions) {
  const byMerchant = new Map();
  for (const tx of transactions) {
    const list = byMerchant.get(tx.normalizedMerchant) ?? [];
    list.push(tx);
    byMerchant.set(tx.normalizedMerchant, list);
  }
  return [...byMerchant.entries()]
    .map(([merchant, items]) => ({
      merchant,
      count: items.length,
      months: [...new Set(items.map((tx) => tx.month))].sort(),
      total: roundMoney(sum(items.map((tx) => tx.expense))),
      average: roundMoney(sum(items.map((tx) => tx.expense)) / items.length),
    }))
    .filter((item) => item.months.length >= 2 || item.count >= 2)
    .sort((a, b) => b.total - a.total);
}

function detectAnomalies(allTransactions, expenses, monthlyByCategory, merchantTotals, recurring) {
  const anomalies = [];
  const suspicious = expenses
    .filter((tx) => tx.category === 'Needs review' || /MYSTERY|TECH SUPPORT|855|SUPPORT CO/i.test(tx.originalDescription))
    .sort((a, b) => b.expense - a.expense)[0];
  if (suspicious) {
    anomalies.push({
      severity: 'critical',
      type: 'weird charge',
      title: `${money(suspicious.expense)} at ${displayMerchant(suspicious.normalizedMerchant)} needs review`,
      amount: suspicious.expense,
      merchant: suspicious.normalizedMerchant,
      date: suspicious.date,
      detail: `This is the charge people miss: ${suspicious.originalDescription}. It does not fit the rest of the spending pattern.`,
      action: 'Search your email, then dispute or cancel if you do not recognize it.',
    });
  }

  const duplicates = allTransactions.filter((tx) => tx.duplicate);
  if (duplicates.length) {
    anomalies.push({
      severity: 'high',
      type: 'duplicate rows',
      title: `${duplicates.length} duplicate transaction rows were detected`,
      amount: roundMoney(sum(duplicates.map((tx) => tx.expense))),
      detail: 'The export appears to include repeated rows. The report excludes duplicate rows from totals, but this is exactly how budget math gets quietly inflated.',
      action: 'Review the duplicate rows before importing this into any budget app.',
    });
  }

  for (const item of recurring.slice(0, 4)) {
    anomalies.push({
      severity: item.total >= 100 ? 'high' : 'medium',
      type: 'recurring subscription',
      title: `${displayMerchant(item.merchant)} hit ${item.count} times for ${money(item.total)}`,
      amount: item.total,
      merchant: item.merchant,
      detail: `Recurring charges showed up in ${item.months.join(', ')}. This is subscription creep, not a one-time purchase.`,
      action: `Open ${displayMerchant(item.merchant)} and cancel it if you would not buy it again today.`,
    });
  }

  const categories = new Set(Object.values(monthlyByCategory).flatMap((month) => Object.keys(month)));
  for (const category of categories) {
    const points = Object.entries(monthlyByCategory).map(([month, values]) => ({ month, amount: values[category] ?? 0 }));
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1].amount;
      const current = points[i].amount;
      if (previous >= 25 && current - previous >= 75 && current / previous >= 1.75) {
        anomalies.push({
          severity: 'medium',
          type: 'category spike',
          title: `${category} jumped from ${money(previous)} to ${money(current)} in ${points[i].month}`,
          amount: roundMoney(current - previous),
          detail: `That is a ${money(current - previous)} increase in one category month over month.`,
          action: `Look at the ${category} transactions from ${points[i].month} and decide what was real versus drift.`,
        });
      }
    }
  }

  const large = expenses
    .filter((tx) => tx.expense >= 250 && !['Housing', 'Travel'].includes(tx.category) && tx !== suspicious)
    .sort((a, b) => b.expense - a.expense)
    .slice(0, 2);
  for (const tx of large) {
    anomalies.push({
      severity: 'medium',
      type: 'large charge',
      title: `${money(tx.expense)} at ${displayMerchant(tx.normalizedMerchant)} stands out`,
      amount: tx.expense,
      merchant: tx.normalizedMerchant,
      date: tx.date,
      detail: `This single charge is larger than most discretionary transactions in the file.`,
      action: 'Confirm it was intentional and not a renewal, duplicate, or account-sharing charge.',
    });
  }

  return anomalies.slice(0, 10);
}

function recommendCuts(categoryTotals, subcategoryTotals, recurring, anomalies, coffeeTotal) {
  const cuts = [];
  if (coffeeTotal >= 75) {
    cuts.push({
      title: 'Put coffee on a weekly cap',
      amount: roundMoney(Math.min(coffeeTotal * 0.45, coffeeTotal - 60)),
      detail: `Coffee totaled ${money(coffeeTotal)}. Cap it at two paid coffees per week and keep the rest at home.`,
    });
  }

  const subscriptionTotal = categoryTotals.Subscriptions ?? 0;
  if (subscriptionTotal >= 40) {
    const targets = recurring.slice(0, 3).map((item) => displayMerchant(item.merchant)).join(', ') || 'the recurring charges';
    cuts.push({
      title: 'Cancel the subscriptions you would not rebuy today',
      amount: roundMoney(Math.min(subscriptionTotal * 0.6, subscriptionTotal)),
      detail: `${targets} account for quiet recurring spend. Cancel two before the next billing cycle.`,
    });
  }

  const deliveryTotal = (categoryTotals['Late-night food'] ?? 0) + (categoryTotals['Restaurants and delivery'] ?? 0);
  if (deliveryTotal >= 100) {
    cuts.push({
      title: 'Kill the late-night delivery loop',
      amount: roundMoney(deliveryTotal * 0.5),
      detail: `Delivery/takeout totaled ${money(deliveryTotal)}. Set a hard rule: no delivery after 9 PM.`,
    });
  }

  const weird = anomalies.find((item) => item.type === 'weird charge');
  if (weird) {
    cuts.push({
      title: 'Investigate and stop the weird charge',
      amount: weird.amount,
      detail: `${weird.title}. Treat this as a same-day review, not a maybe-later task.`,
    });
  }

  const impulse = categoryTotals['Impulse buys'] ?? 0;
  if (impulse >= 100) {
    cuts.push({
      title: 'Add a 24-hour cart rule',
      amount: roundMoney(impulse * 0.35),
      detail: `Impulse buys totaled ${money(impulse)}. Put Amazon/Target/retail purchases in the cart overnight before checkout.`,
    });
  }

  const fallback = Object.entries(sortObjectByValue(subcategoryTotals))[0];
  if (cuts.length < 3 && fallback) {
    cuts.push({
      title: `Put a cap on ${fallback[0]}`,
      amount: roundMoney(fallback[1] * 0.25),
      detail: `${fallback[0]} was the biggest behavior bucket. Cut one quarter of it first.`,
    });
  }

  return cuts
    .filter((cut) => cut.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);
}

async function narrateWithFallback(config, household, location, analysis) {
  try {
    const prompt = await fs.readFile(path.join(ROOT, config.claws.narrator), 'utf8');
    const payload = {
      household,
      location,
      totalSpend: analysis.totalSpend,
      netCashFlow: analysis.netCashFlow,
      categoryTotals: analysis.categoryTotals,
      anomalies: analysis.anomalies.slice(0, 6),
      cuts: analysis.cuts,
      coffeeTotal: analysis.coffeeTotal,
    };
    const response = await callOllama(config, [
      { role: 'system', content: `${prompt}\nReturn concise Markdown only. No investment, tax, legal, or debt advice.` },
      { role: 'user', content: `/no_think\n${JSON.stringify(payload)}` },
    ]);
    return response.trim() || deterministicNarrative(household, location, analysis);
  } catch (error) {
    return deterministicNarrative(household, location, analysis, error.message);
  }
}

function deterministicNarrative(household, location, analysis, fallbackReason = null) {
  const topCategory = Object.entries(analysis.categoryTotals)
    .find(([category]) => !['Housing', 'Bills and utilities', 'Income and credits'].includes(category))
    ?? Object.entries(analysis.categoryTotals)[0]
    ?? ['spending', 0];
  const anomaly = analysis.anomalies[0];
  const coffee = analysis.coffeeTotal >= 50
    ? `You spent ${money(analysis.coffeeTotal)} on coffee. That is a cheap flight to Mexico if you catch the right deal.`
    : `Coffee was ${money(analysis.coffeeTotal)}, which is not the main leak this time.`;
  const weird = anomaly
    ? `The charge to look at first: ${anomaly.title}.`
    : 'No single weird charge dominated the file, so the problem is pattern drift.';
  const modelNote = fallbackReason ? `\n\n_Model narration fallback used: ${fallbackReason}_` : '';
  return `## Spending autopsy for ${household}\n\n${coffee}\n\nYour biggest flexible bucket was **${topCategory[0]}** at **${money(topCategory[1])}**. ${weird}\n\nThe short version: this is less about one giant mistake and more about recurring convenience charges that stopped asking permission.${modelNote}`;
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
        temperature: config.temperature ?? 0.35,
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

function renderSummaryMarkdown(household, location, analysis, narrative) {
  return `# Spending Autopsy: ${household}\n\nLocation: ${location}\n\n${narrative}\n\n## Category Breakdown\n\n${markdownTable(['Category', 'Spend'], Object.entries(analysis.categoryTotals).map(([category, amount]) => [category, money(amount)]))}\n\n## Three Cuts\n\n${analysis.cuts.map((cut, i) => `${i + 1}. **${cut.title}** - save about ${money(cut.amount)}. ${cut.detail}`).join('\n')}\n`;
}

function renderAnomaliesMarkdown(analysis) {
  return `# Anomalies\n\n${analysis.anomalies.map((item) => `## ${item.title}\n\n- Severity: ${item.severity}\n- Type: ${item.type}\n- Amount: ${money(item.amount ?? 0)}\n- Why it matters: ${item.detail}\n- Next action: ${item.action}\n`).join('\n')}`;
}

function renderCutsMarkdown(analysis) {
  return `# Three Things To Cut\n\n${analysis.cuts.map((cut, i) => `${i + 1}. **${cut.title}**\n   - Estimated savings: ${money(cut.amount)}\n   - ${cut.detail}`).join('\n\n')}\n`;
}

function renderHtml(household, location, analysis, narrative, transactions) {
  const maxCategory = Math.max(...Object.values(analysis.categoryTotals), 1);
  const categoryRows = Object.entries(analysis.categoryTotals).map(([category, amount]) => `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(category)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (amount / maxCategory) * 100).toFixed(1)}%"></div></div>
        <div class="bar-value">${money(amount)}</div>
      </div>`).join('');
  const monthRows = Object.entries(analysis.monthlyTotals).map(([month, amount]) => `<tr><td>${month}</td><td>${money(amount)}</td></tr>`).join('');
  const anomalies = analysis.anomalies.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><br><span>${escapeHtml(item.detail)}</span><br><em>${escapeHtml(item.action)}</em></li>`).join('');
  const cuts = analysis.cuts.map((cut) => `<li><strong>${escapeHtml(cut.title)}</strong> <span>${money(cut.amount)}</span><br>${escapeHtml(cut.detail)}</li>`).join('');
  const recent = transactions.filter((tx) => tx.type === 'expense' && !tx.duplicate).slice(0, 80)
    .map((tx) => `<tr><td>${tx.date}</td><td>${escapeHtml(displayMerchant(tx.normalizedMerchant))}</td><td>${escapeHtml(tx.category)}</td><td>${escapeHtml(tx.subcategory)}</td><td>${money(tx.expense)}</td></tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spending Autopsy: ${escapeHtml(household)}</title>
<style>
:root{color-scheme:light;--ink:#172026;--muted:#667085;--line:#d8dee8;--bg:#f6f7f9;--panel:#fff;--red:#b42318;--teal:#0f766e;--gold:#b7791f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1120px;margin:0 auto;padding:32px 20px 56px}
h1{font-size:34px;line-height:1.1;margin:0 0 6px}h2{font-size:20px;margin:30px 0 12px}.muted{color:var(--muted)}
.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0}
.metric{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}.metric b{display:block;font-size:24px}
.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px}
.bar-row{display:grid;grid-template-columns:165px 1fr 80px;align-items:center;gap:10px;margin:10px 0}.bar-label{font-weight:600}.bar-track{height:14px;background:#edf1f5;border-radius:7px;overflow:hidden}.bar-fill{height:100%;background:var(--teal)}.bar-value{text-align:right}
ul{padding-left:22px}li{margin:0 0 12px}.anomalies li:first-child strong{color:var(--red)}
table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{padding:9px 8px;border-bottom:1px solid var(--line);text-align:left}th{font-size:12px;text-transform:uppercase;color:var(--muted)}
.narrative{font-size:17px}.cuts strong{color:var(--teal)}@media(max-width:780px){.summary,.grid{grid-template-columns:1fr}.bar-row{grid-template-columns:1fr}.bar-value{text-align:left}}
</style>
</head>
<body>
<main>
  <h1>Spending Autopsy</h1>
  <div class="muted">${escapeHtml(household)} &middot; ${escapeHtml(location)} &middot; ${analysis.months.join(' to ')}</div>
  <section class="summary">
    <div class="metric"><span>Total spend</span><b>${money(analysis.totalSpend)}</b></div>
    <div class="metric"><span>Net cash flow</span><b>${money(analysis.netCashFlow)}</b></div>
    <div class="metric"><span>Coffee</span><b>${money(analysis.coffeeTotal)}</b></div>
    <div class="metric"><span>Anomalies</span><b>${analysis.anomalies.length}</b></div>
  </section>
  <section class="panel narrative">${markdownToHtml(narrative)}</section>
  <section class="grid">
    <div class="panel">
      <h2>Visual Spending Breakdown</h2>
      ${categoryRows}
    </div>
    <div class="panel">
      <h2>Monthly Spend</h2>
      <table><tbody>${monthRows}</tbody></table>
    </div>
  </section>
  <section class="grid">
    <div class="panel anomalies">
      <h2>Anomaly Flags</h2>
      <ul>${anomalies}</ul>
    </div>
    <div class="panel cuts">
      <h2>Three Things To Cut</h2>
      <ul>${cuts}</ul>
    </div>
  </section>
  <section class="panel">
    <h2>Transaction Ledger</h2>
    <table><thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Behavior</th><th>Spend</th></tr></thead><tbody>${recent}</tbody></table>
  </section>
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

function transactionToCsvRow(tx) {
  return {
    date: tx.date,
    merchant: displayMerchant(tx.normalizedMerchant),
    original_description: tx.originalDescription,
    amount: tx.amount.toFixed(2),
    category: tx.category,
    subcategory: tx.subcategory,
    behavior: tx.behavior,
    duplicate: tx.duplicate ? 'yes' : 'no',
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

function markdownTable(headers, rows) {
  return `${headers.join(' | ')}\n${headers.map(() => '---').join(' | ')}\n${rows.map((row) => row.join(' | ')).join('\n')}`;
}

function sortObjectByValue(obj) {
  return Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
}

function sortObjectByKey(obj) {
  return Object.fromEntries(Object.entries(obj).sort((a, b) => a[0].localeCompare(b[0])));
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function money(value) {
  const amount = roundMoney(value);
  return `${amount < 0 ? '-' : ''}$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayMerchant(merchant) {
  return String(merchant || 'Unknown')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
    .slice(0, 80) || 'spending';
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
