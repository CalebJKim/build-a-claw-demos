#!/usr/bin/env node
import { planPto } from "./orchestrator.js";
import { formatPlan } from "./util/format.js";

const DISCORD_API = "https://discord.com/api/v10";
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = 1 | 512 | 32768 | 4096;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example and export your Discord bot token first.`);
  }
  return value;
}

function mentioned(content, botUserId) {
  return content.includes(`<@${botUserId}>`) || content.includes(`<@!${botUserId}>`);
}

async function postMessage(token, channelId, content) {
  const chunks = content.match(/[\s\S]{1,1850}/g) || [content];
  for (const chunk of chunks) {
    const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: chunk })
    });

    if (!response.ok) {
      throw new Error(`Discord send failed: ${response.status} ${await response.text()}`);
    }
  }
}

async function handleMessage({ token, botUserId, event }) {
  if (event.author?.bot) return;
  const prefix = process.env.DISCORD_TRIGGER_PREFIX || "!pto";
  const requireMention = process.env.DISCORD_REQUIRE_MENTION !== "0";
  const content = event.content || "";
  const isCommand = content.trim().startsWith(prefix);
  const isMentioned = mentioned(content, botUserId);

  if (requireMention && !isMentioned && !isCommand) return;
  if (!isCommand && !/plan my pto|pto in two weeks|vacation|trip/i.test(content)) return;

  const prompt = content
    .replaceAll(`<@${botUserId}>`, "")
    .replaceAll(`<@!${botUserId}>`, "")
    .replace(prefix, "")
    .trim() || "Plan my PTO in two weeks.";

  await postMessage(token, event.channel_id, "Coordinator claw is waking research, finance, and scheduling now...");

  const plan = await planPto({
    prompt,
    today: process.env.DEMO_TODAY || new Date().toISOString().slice(0, 10),
    profilePath: process.env.DEMO_PROFILE || "src/data/demo-profile.json",
    bookingMode: process.env.BOOKING_MODE || "dry-run"
  });

  await postMessage(token, event.channel_id, formatPlan(plan, { includeTranscript: false }));
}

async function main() {
  const token = requireEnv("DISCORD_BOT_TOKEN");
  const ws = new WebSocket(GATEWAY_URL);
  let heartbeatTimer = null;
  let botUserId = null;

  ws.addEventListener("message", async (message) => {
    const payload = JSON.parse(message.data);

    if (payload.op === 10) {
      heartbeatTimer = setInterval(() => {
        ws.send(JSON.stringify({ op: 1, d: null }));
      }, payload.d.heartbeat_interval);

      ws.send(JSON.stringify({
        op: 2,
        d: {
          token,
          intents: INTENTS,
          properties: { os: process.platform, browser: "pto-team-demo", device: "pto-team-demo" }
        }
      }));
      return;
    }

    if (payload.op === 0 && payload.t === "READY") {
      botUserId = payload.d.user.id;
      console.log(`Discord demo bot ready as ${payload.d.user.username} (${botUserId})`);
      return;
    }

    if (payload.op === 0 && payload.t === "MESSAGE_CREATE" && botUserId) {
      try {
        await handleMessage({ token, botUserId, event: payload.d });
      } catch (error) {
        console.error(error);
        await postMessage(token, payload.d.channel_id, `Demo error: ${error.message}`);
      }
    }
  });

  ws.addEventListener("close", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    console.log("Discord gateway closed.");
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
