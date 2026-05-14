#!/usr/bin/env node
import process from "node:process";
import {
  collectBriefing,
  loadConfig,
  renderDigest,
  sendTelegram,
  writeBriefingOutputs
} from "./briefing-core.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.config);
  const briefing = await collectBriefing(config, {
    demo: args.demo,
    timeoutMs: args.timeoutMs,
    now: args.now
  });
  const digest = renderDigest(briefing, config);
  const outputs = await writeBriefingOutputs(briefing, digest);

  if (args.json) {
    console.log(JSON.stringify(briefing, null, 2));
  } else {
    console.log(digest);
    console.log("");
    console.log(`Wrote ${outputs.digestPath}`);
  }

  if (args.send) {
    await sendTelegram(digest, config);
    console.log("Sent Telegram briefing.");
  } else if (!args.json) {
    console.log("Dry run only. Add --send after setting TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.");
  }
}

function parseArgs(argv) {
  const args = {
    config: process.env.MORNING_BRIEFING_CONFIG || "config/briefing.json",
    demo: false,
    json: false,
    send: false,
    timeoutMs: 8000,
    now: undefined
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      args.config = argv[++i];
    } else if (arg === "--demo") {
      args.demo = true;
    } else if (arg === "--live") {
      args.demo = false;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--send") {
      args.send = true;
    } else if (arg === "--dry-run") {
      args.send = false;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i]);
    } else if (arg === "--now") {
      args.now = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node src/morning-briefing.mjs [options]

Options:
  --demo              Use fixture news and weather for a repeatable demo
  --live              Fetch live weather and news, falling back to fixtures
  --send              Send the digest to Telegram
  --dry-run           Print and write the digest without sending
  --json              Print structured briefing JSON
  --config <path>     Config file, default config/briefing.json
  --timeout-ms <n>    Live fetch timeout, default 8000
  --now <iso>         Override current time for demos/tests
`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
