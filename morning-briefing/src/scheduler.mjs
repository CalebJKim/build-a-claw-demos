#!/usr/bin/env node
import process from "node:process";
import {
  collectBriefing,
  loadConfig,
  nextRunAt,
  renderDigest,
  sendTelegram,
  writeBriefingOutputs
} from "./briefing-core.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.config);

  if (args.once) {
    await runBriefing(config, args);
    return;
  }

  while (true) {
    const next = nextRunAt(new Date(), config.schedule);
    const waitMs = next.getTime() - Date.now();
    console.log(`Next ${config.title} run: ${next.toISOString()} (${config.schedule.timezone})`);
    await sleep(waitMs);
    await runBriefing(config, args);
  }
}

async function runBriefing(config, args) {
  const briefing = await collectBriefing(config, {
    demo: args.demo,
    timeoutMs: args.timeoutMs
  });
  const digest = renderDigest(briefing, config);
  await writeBriefingOutputs(briefing, digest);
  if (args.dryRun) {
    console.log(digest);
    return;
  }
  await sendTelegram(digest, config);
  console.log(`Sent ${config.title} at ${new Date().toISOString()}`);
}

function parseArgs(argv) {
  const args = {
    config: process.env.MORNING_BRIEFING_CONFIG || "config/briefing.json",
    demo: false,
    dryRun: false,
    once: false,
    timeoutMs: 8000
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      args.config = argv[++i];
    } else if (arg === "--demo") {
      args.demo = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--once") {
      args.once = true;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i]);
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
  console.log(`Usage: node src/scheduler.mjs [options]

Runs the morning briefing every day at the configured wall-clock time.

Options:
  --once              Run immediately once and exit
  --demo              Use fixture data
  --dry-run           Print instead of sending to Telegram
  --config <path>     Config file, default config/briefing.json
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
