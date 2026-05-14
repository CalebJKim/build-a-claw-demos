#!/usr/bin/env node
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

loadDotEnv(path.join(root, ".env"));

const modeAliases = {
  all: ["all", "full", "demo", "brief", "overview", "全部", "完整", "總覽", "簡報"],
  maintenance: ["maintenance", "maint", "pm", "predictive", "asset", "machine", "維護", "保養", "設備", "預測性維護"],
  quality: ["quality", "qa", "qms", "containment", "lot", "品質", "品管", "圍堵", "批次", "異常"],
  schedule: ["schedule", "scheduling", "production", "capacity", "recovery", "排程", "生產", "產能", "復原"],
  supplier: ["supplier", "supply", "material", "inventory", "buyer", "供應商", "供應鏈", "物料", "庫存", "採購"],
  diagnostics: ["diagnostics", "diagnostic", "fdc", "reporting", "report", "診斷", "診斷報告", "報告"],
  triage: ["triage", "resolution", "resolve", "automated", "automation", "分級", "解決", "自動化", "處置"]
};

const helpAliases = new Set(["help", "?", "commands", "command", "menu", "說明", "幫助", "指令", "選單"]);

const languageAliases = new Map([
  ["bilingual", "bilingual"],
  ["both", "bilingual"],
  ["雙語", "bilingual"],
  ["en", "en"],
  ["english", "en"],
  ["英文", "en"],
  ["zh", "zh-TW"],
  ["zh-tw", "zh-TW"],
  ["zh_tw", "zh-TW"],
  ["traditional", "zh-TW"],
  ["traditional-mandarin", "zh-TW"],
  ["traditional-chinese", "zh-TW"],
  ["繁中", "zh-TW"],
  ["繁體", "zh-TW"],
  ["中文", "zh-TW"]
]);

if (process.argv.includes("--help")) {
  console.log(`LINE webhook for the Semiconductor Manufacturing Ops agent demo

Required environment:
  LINE_CHANNEL_SECRET       Messaging API channel secret.
  LINE_CHANNEL_ACCESS_TOKEN Messaging API channel access token.

Optional environment:
  PORT=3000
  HOST=0.0.0.0
  LINE_WEBHOOK_PATH=/line/webhook
  LINE_DEFAULT_LANG=bilingual
  LINE_MAX_TEXT_CHARS=4800
  LINE_REPLY_DRY_RUN=1      Log replies instead of calling LINE.
  LINE_SKIP_SIGNATURE=1     Local testing only. Do not use for real webhooks.
`);
  process.exit(0);
}

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const webhookPath = process.env.LINE_WEBHOOK_PATH || "/line/webhook";
const channelSecret = process.env.LINE_CHANNEL_SECRET || "";
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const dryRun = parseBoolean(process.env.LINE_REPLY_DRY_RUN);
const skipSignature = parseBoolean(process.env.LINE_SKIP_SIGNATURE);
const defaultLanguage = normalizeLanguage(process.env.LINE_DEFAULT_LANG || "bilingual");
const maxTextChars = Number(process.env.LINE_MAX_TEXT_CHARS || 4800);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

if (!Number.isFinite(maxTextChars) || maxTextChars < 500) {
  throw new Error(`Invalid LINE_MAX_TEXT_CHARS value: ${process.env.LINE_MAX_TEXT_CHARS}`);
}

if (!channelSecret && !skipSignature) {
  throw new Error("LINE_CHANNEL_SECRET is required unless LINE_SKIP_SIGNATURE=1 is set for local testing.");
}

if (!channelAccessToken && !dryRun) {
  throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required unless LINE_REPLY_DRY_RUN=1 is set for local testing.");
}

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue
      .replace(/^['"]|['"]$/g, "")
      .replace(/\\n/g, "\n");
  }
}

function normalizeLanguage(value) {
  return languageAliases.get(String(value || "").toLowerCase()) || "bilingual";
}

function stripLanguageToken(text) {
  const tokens = text.trim().split(/\s+/);
  const kept = [];
  let language = defaultLanguage;

  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i];
    const token = raw.toLowerCase();

    if (token === "--lang" || token === "-l") {
      const next = tokens[i + 1];
      const normalized = normalizeLanguage(next);
      if (next && languageAliases.has(String(next).toLowerCase())) {
        language = normalized;
        i += 1;
        continue;
      }
    }

    const inlineLang = token.startsWith("--lang=")
      ? token.slice("--lang=".length)
      : token.startsWith("-l=")
        ? token.slice("-l=".length)
        : null;
    if (inlineLang && languageAliases.has(inlineLang)) {
      language = normalizeLanguage(inlineLang);
      continue;
    }

    const cleaned = token.replace(/^--?/, "");
    if (languageAliases.has(cleaned)) {
      language = normalizeLanguage(cleaned);
      continue;
    }

    kept.push(raw);
  }

  return {
    language,
    commandText: kept.join(" ").trim() || text.trim()
  };
}

function resolveAgentRequest(text) {
  const trimmed = text.trim();
  if (!trimmed) return { type: "help" };

  const { language, commandText } = stripLanguageToken(trimmed);
  const command = commandText
    .toLowerCase()
    .replace(/[.,!?;:，。！？；：]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (helpAliases.has(command)) return { type: "help" };

  for (const [mode, aliases] of Object.entries(modeAliases)) {
    if (aliases.some((alias) => command === alias || command.includes(alias))) {
      return { type: "demo", mode, language };
    }
  }

  return { type: "help" };
}

function helpText() {
  return [
    "Semiconductor Manufacturing Ops Agent on LINE",
    "半導體製造營運代理 LINE 入口",
    "",
    "Send a text command to run a semiconductor fab demo use case.",
    "傳送文字指令即可執行半導體晶圓廠示範使用案例。",
    "",
    "Commands:",
    "指令：",
    "- all / 全部",
    "- maintenance / 維護",
    "- quality / 品質",
    "- schedule / 排程",
    "- supplier / 供應商",
    "- diagnostics / 診斷",
    "- triage / 自動化分級",
    "",
    "Add `en`, `zh`, or `bilingual` to choose output language.",
    "加入 `en`、`zh` 或 `bilingual` 可選擇輸出語言。",
    "",
    "Examples:",
    "範例：",
    "maintenance",
    "zh quality",
    "en supplier"
  ].join("\n");
}

function runDemo(mode, language) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/demo-runner.mjs", mode, "--lang", language, "--no-write"],
      { cwd: root, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Demo runner failed: ${stderr || error.message}`));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function splitTextForLine(text) {
  const chunks = [];
  let current = "";
  const paragraphs = text.trim().split(/\n{2,}/);

  function pushCurrent() {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  }

  for (const paragraph of paragraphs) {
    const block = paragraph.trim();
    if (!block) continue;

    if (block.length > maxTextChars) {
      pushCurrent();
      for (let i = 0; i < block.length; i += maxTextChars) {
        chunks.push(block.slice(i, i + maxTextChars));
      }
      continue;
    }

    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > maxTextChars) {
      pushCurrent();
      current = block;
    } else {
      current = next;
    }
  }

  pushCurrent();

  if (chunks.length <= 5) return chunks;

  const returned = chunks.slice(0, 5);
  const suffix = "\n\nOutput truncated for LINE. Send a narrower command such as `maintenance` or `quality`.\nLINE 輸出已截短。請傳送較精準的指令，例如 `maintenance` 或 `quality`。";
  returned[4] = `${returned[4].slice(0, Math.max(0, maxTextChars - suffix.length))}${suffix}`;
  return returned;
}

function toLineMessages(text) {
  return splitTextForLine(text).map((chunk) => ({
    type: "text",
    text: chunk
  }));
}

function verifyLineSignature(rawBody, signature) {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");
  const received = Buffer.from(signature);
  const generated = Buffer.from(expected);
  return received.length === generated.length && crypto.timingSafeEqual(received, generated);
}

function postJson(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve({ statusCode: response.statusCode, body: responseBody });
          return;
        }
        reject(new Error(`LINE reply failed with ${response.statusCode}: ${responseBody}`));
      });
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function replyToLine(replyToken, messages) {
  if (dryRun) {
    console.log(`[line dry-run] replyToken=${replyToken}`);
    for (const [index, message] of messages.entries()) {
      console.log(`[line dry-run] message ${index + 1}/${messages.length}\n${message.text}\n`);
    }
    return;
  }

  await postJson(
    "https://api.line.me/v2/bot/message/reply",
    { Authorization: `Bearer ${channelAccessToken}` },
    { replyToken, messages }
  );
}

async function handleTextEvent(event) {
  const request = resolveAgentRequest(event.message.text);
  const responseText = request.type === "demo"
    ? await runDemo(request.mode, request.language)
    : helpText();

  await replyToLine(event.replyToken, toLineMessages(responseText));
}

async function handleEvent(event) {
  if (!event.replyToken) return;

  if (event.type === "message" && event.message?.type === "text") {
    await handleTextEvent(event);
    return;
  }

  if (event.type === "follow") {
    await replyToLine(event.replyToken, toLineMessages(helpText()));
    return;
  }

  if (event.type === "message") {
    await replyToLine(event.replyToken, toLineMessages("Please send a text command such as `maintenance`, `quality`, `schedule`, `supplier`, `diagnostics`, or `triage`.\n請傳送文字指令，例如 `maintenance`、`quality`、`schedule`、`supplier`、`diagnostics` 或 `triage`。"));
  }
}

async function handleWebhookEvents(events = []) {
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (error) {
      console.error(`[line webhook] failed to handle event: ${error.message}`);
    }
  }
}

async function readRawBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error("Webhook body is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/health")) {
    sendJson(response, 200, {
      ok: true,
      service: "manufacturing-ops-line-webhook",
      webhookPath,
      dryRun,
      skipSignature,
      defaultLanguage
    });
    return;
  }

  if (request.method !== "POST" || requestUrl.pathname !== webhookPath) {
    sendJson(response, 404, { ok: false, error: "not_found" });
    return;
  }

  try {
    const rawBody = await readRawBody(request);
    if (!skipSignature && !verifyLineSignature(rawBody, request.headers["x-line-signature"])) {
      sendJson(response, 401, { ok: false, error: "invalid_signature" });
      return;
    }

    const payload = JSON.parse(rawBody.toString("utf8"));
    sendJson(response, 200, { ok: true });
    handleWebhookEvents(payload.events || []).catch((error) => {
      console.error(`[line webhook] async handler failed: ${error.message}`);
    });
  } catch (error) {
    console.error(`[line webhook] request failed: ${error.message}`);
    if (!response.headersSent) sendJson(response, 400, { ok: false, error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Semiconductor Manufacturing Ops LINE webhook listening on http://${host}:${port}${webhookPath}`);
  if (dryRun) console.log("LINE_REPLY_DRY_RUN=1 is enabled; replies will be logged locally.");
  if (skipSignature) console.log("LINE_SKIP_SIGNATURE=1 is enabled; use only for local testing.");
});
