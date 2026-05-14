import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = "config/briefing.json";
const DEFAULT_FIXTURES = "data/fixtures.json";

const WEATHER_CODES = new Map([
  [0, "clear"],
  [1, "mostly clear"],
  [2, "partly cloudy"],
  [3, "overcast"],
  [45, "foggy"],
  [48, "foggy"],
  [51, "light drizzle"],
  [53, "drizzle"],
  [55, "heavy drizzle"],
  [61, "light rain"],
  [63, "rain"],
  [65, "heavy rain"],
  [71, "light snow"],
  [73, "snow"],
  [75, "heavy snow"],
  [80, "light showers"],
  [81, "showers"],
  [82, "heavy showers"],
  [95, "thunderstorms"]
]);

export function projectPath(inputPath = "") {
  if (!inputPath) {
    return PROJECT_ROOT;
  }
  return path.isAbsolute(inputPath) ? inputPath : path.join(PROJECT_ROOT, inputPath);
}

export async function readJson(inputPath) {
  const file = projectPath(inputPath);
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text);
}

export async function loadConfig(configPath = process.env.MORNING_BRIEFING_CONFIG || DEFAULT_CONFIG) {
  const raw = await readJson(configPath);
  return raw.briefing ?? raw;
}

export async function loadFixtures(fixturesPath = DEFAULT_FIXTURES) {
  return readJson(fixturesPath);
}

export async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "accept": "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "accept": "application/rss+xml, application/xml, text/xml, text/plain" },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function getWeather(config, options = {}, fixtures = {}) {
  if (options.demo) {
    return fixtures.weather;
  }

  const { latitude, longitude, label } = config.location;
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto"
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;

  try {
    const data = await fetchJson(url, options.timeoutMs);
    const current = data.current ?? {};
    const daily = data.daily ?? {};
    const weatherLabel = WEATHER_CODES.get(current.weather_code) ?? "mixed conditions";
    const rainChance = firstNumber(daily.precipitation_probability_max);
    const high = firstNumber(daily.temperature_2m_max);
    const low = firstNumber(daily.temperature_2m_min);
    const temp = roundedNumber(current.temperature_2m);
    const apparent = roundedNumber(current.apparent_temperature);
    const wind = roundedNumber(current.wind_speed_10m);
    const rainPhrase = rainChance >= 50 ? "rain is likely" : rainChance > 20 ? "rain is possible" : "low rain risk";

    return {
      source: "open-meteo",
      url,
      summary: `${label} is ${weatherLabel}; ${rainPhrase} later today.`,
      temperature: temp,
      apparentTemperature: apparent,
      high,
      low,
      rainChance,
      windMph: wind
    };
  } catch (error) {
    return {
      ...fixtures.weather,
      source: "fixture-fallback",
      error: error.message
    };
  }
}

export async function getTopicNews(topic, options = {}, fixtures = {}) {
  const fixtureItems = fixtures.news?.[topic.name] ?? [];
  if (options.demo) {
    return {
      ...topic,
      source: "fixture",
      items: fixtureItems.slice(0, topic.limit ?? 3)
    };
  }

  const googleParams = new URLSearchParams({
    q: topic.query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en"
  });
  const googleUrl = `https://news.google.com/rss/search?${googleParams}`;
  let googleError;
  try {
    const xml = await fetchText(googleUrl, options.timeoutMs);
    const items = parseGoogleNewsRss(xml).slice(0, topic.limit ?? 3);
    if (items.length > 0) {
      return {
        ...topic,
        source: "google-news",
        url: googleUrl,
        items
      };
    }
  } catch (error) {
    googleError = error;
  }

  const params = new URLSearchParams({
    query: topic.query,
    mode: "artlist",
    format: "json",
    maxrecords: String(topic.limit ?? 3),
    sort: "datedesc"
  });
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;

  try {
    const data = await fetchJson(url, options.timeoutMs);
    const articles = Array.isArray(data.articles) ? data.articles : [];
    const items = dedupeByTitle(articles.map(mapGdeltArticle)).slice(0, topic.limit ?? 3);
    return {
      ...topic,
      source: "gdelt",
      url,
      items: items.length > 0 ? items : fixtureItems.slice(0, topic.limit ?? 3)
    };
  } catch (error) {
    return {
      ...topic,
      source: "fixture-fallback",
      error: googleError ? `${googleError.message}; ${error.message}` : error.message,
      items: fixtureItems.slice(0, topic.limit ?? 3)
    };
  }
}

export async function getUpdates(config, now = new Date()) {
  const raw = await readJson(config.updatesFile);
  const timezone = config.schedule?.timezone ?? "UTC";
  return {
    calendar: (raw.calendar ?? []).map((item) => ({
      ...item,
      date: dateKeyForOffset(now, timezone, item.dayOffset ?? 0)
    })),
    tasks: (raw.tasks ?? []).map((item) => ({
      ...item,
      dueDate: dateKeyForOffset(now, timezone, item.dueOffsetDays ?? 0)
    })),
    messages: raw.messages ?? []
  };
}

export function rankTimeSensitive(updates, config, now = new Date()) {
  const timezone = config.schedule?.timezone ?? "UTC";
  const today = dateKeyForOffset(now, timezone, 0);
  const tomorrow = dateKeyForOffset(now, timezone, 1);
  const items = [];

  for (const event of updates.calendar ?? []) {
    if (event.date === today || event.date === tomorrow || event.priority === "high") {
      const when = event.date === today ? `today at ${event.time}` : `tomorrow at ${event.time}`;
      items.push({
        kind: "calendar",
        priority: priorityScore(event.priority),
        text: `${event.title} ${when}${event.owner ? ` with ${event.owner}` : ""}`
      });
    }
  }

  for (const task of updates.tasks ?? []) {
    if (task.dueDate === today || task.dueDate === tomorrow || task.priority === "high") {
      const when = task.dueDate === today ? "today" : task.dueDate === tomorrow ? "tomorrow" : task.dueDate;
      items.push({
        kind: "task",
        priority: priorityScore(task.priority),
        text: `${task.title} due ${when}`
      });
    }
  }

  for (const message of updates.messages ?? []) {
    if (message.sensitivity === "time-sensitive") {
      items.push({
        kind: "message",
        priority: 3,
        text: `${message.source}: ${message.summary}`
      });
    }
  }

  return items
    .sort((a, b) => b.priority - a.priority || a.text.localeCompare(b.text))
    .slice(0, 6);
}

export async function collectBriefing(config, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const fixtures = await loadFixtures(options.fixturesPath ?? DEFAULT_FIXTURES);
  const [weather, updates, ...topics] = await Promise.all([
    getWeather(config, options, fixtures),
    getUpdates(config, now),
    ...config.topics.map((topic) => getTopicNews(topic, options, fixtures))
  ]);

  return {
    title: config.title ?? "Morning Briefing",
    generatedAt: now.toISOString(),
    schedule: config.schedule,
    location: config.location,
    weather,
    timeSensitive: rankTimeSensitive(updates, config, now),
    topics,
    updates
  };
}

export function renderDigest(briefing, config = {}) {
  const maxItems = config.delivery?.maxItemsPerTopic ?? 2;
  const generated = formatGeneratedAt(briefing.generatedAt, briefing.schedule?.timezone);
  const lines = [
    `${briefing.title}`,
    `${briefing.location.label} | ${generated}`,
    "",
    `Weather: ${briefing.weather.summary}`,
    `Now ${briefing.weather.temperature}F, feels ${briefing.weather.apparentTemperature}F. High ${briefing.weather.high}F, low ${briefing.weather.low}F. Rain ${briefing.weather.rainChance}%. Wind ${briefing.weather.windMph} mph.`,
    "",
    "Time-sensitive:"
  ];

  if (briefing.timeSensitive.length === 0) {
    lines.push("- Nothing urgent surfaced.");
  } else {
    for (const item of briefing.timeSensitive) {
      lines.push(`- ${item.text}`);
    }
  }

  lines.push("", "Topics:");
  for (const topic of briefing.topics) {
    lines.push(`${topic.name}:`);
    const items = topic.items.slice(0, maxItems);
    if (items.length === 0) {
      lines.push("- No fresh items found.");
      continue;
    }
    for (const item of items) {
      const source = item.source ? ` (${item.source})` : "";
      lines.push(`- ${truncate(item.title, 120)}${source}`);
    }
  }

  lines.push("", "No app to open. No feed to scroll.");
  return lines.join("\n");
}

export async function writeBriefingOutputs(briefing, digest, outputDir = "out") {
  const dir = projectPath(outputDir);
  await fs.mkdir(dir, { recursive: true });
  const digestPath = path.join(dir, "latest-digest.md");
  const jsonPath = path.join(dir, "latest-briefing.json");
  await Promise.all([
    fs.writeFile(digestPath, `${digest}\n`, "utf8"),
    fs.writeFile(jsonPath, `${JSON.stringify(briefing, null, 2)}\n`, "utf8")
  ]);
  return { digestPath, jsonPath };
}

export async function sendTelegram(digest, config = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN || config.delivery?.telegramBotToken;
  const chatId = process.env.TELEGRAM_CHAT_ID || config.delivery?.telegramChatId;
  if (!token || !chatId) {
    throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID before sending.");
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: digest.slice(0, 3900),
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram send failed with HTTP ${response.status}: ${body}`);
  }

  return response.json();
}

export function parseTimeOfDay(time) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    throw new Error(`Invalid schedule time "${time}". Use HH:MM in 24-hour time.`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function nextRunAt(after, schedule) {
  const timezone = schedule.timezone ?? "UTC";
  const { hour, minute } = parseTimeOfDay(schedule.time);
  const parts = getZonedParts(after, timezone);
  let candidate = zonedWallTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute,
    second: 0
  }, timezone);

  if (candidate.getTime() <= after.getTime()) {
    const nextDay = addDays({ year: parts.year, month: parts.month, day: parts.day }, 1);
    candidate = zonedWallTimeToUtc({
      ...nextDay,
      hour,
      minute,
      second: 0
    }, timezone);
  }

  return candidate;
}

export function dateKeyForOffset(now, timezone, offsetDays) {
  const parts = getZonedParts(now, timezone);
  const shifted = addDays({ year: parts.year, month: parts.month, day: parts.day }, offsetDays);
  return `${shifted.year}-${pad2(shifted.month)}-${pad2(shifted.day)}`;
}

export function getZonedParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour === "24" ? "0" : values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function zonedWallTimeToUtc(parts, timezone) {
  const wallUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);
  let guess = wallUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = timezoneOffsetMs(new Date(guess), timezone);
    guess = wallUtc - offset;
  }
  return new Date(guess);
}

function timezoneOffsetMs(date, timezone) {
  const parts = getZonedParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function addDays(parts, offsetDays) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function mapGdeltArticle(article) {
  return {
    title: article.title,
    source: article.domain || article.sourcecountry || "GDELT",
    url: article.url,
    publishedAt: article.seendate
  };
}

function parseGoogleNewsRss(xml) {
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  return itemBlocks.map((item) => {
    const source = decodeXml(extractXmlTag(item, "source"));
    let title = decodeXml(extractXmlTag(item, "title"));
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(` - ${source}`).length);
    }
    return {
      title,
      source: source || "Google News",
      url: decodeXml(extractXmlTag(item, "link")),
      publishedAt: normalizeDate(decodeXml(extractXmlTag(item, "pubDate")))
    };
  }).filter((item) => item.title);
}

function extractXmlTag(xml, tagName) {
  const match = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(xml);
  return match ? match[1].trim() : "";
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function dedupeByTitle(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = String(item.title ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

function firstNumber(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  return roundedNumber(values[0]);
}

function roundedNumber(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
}

function priorityScore(priority) {
  if (priority === "high") {
    return 4;
  }
  if (priority === "medium") {
    return 2;
  }
  if (priority === "low") {
    return 1;
  }
  return 0;
}

function formatGeneratedAt(isoString, timezone = "UTC") {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(isoString));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function truncate(text, maxLength) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3).trim()}...`;
}
