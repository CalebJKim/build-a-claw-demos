#!/usr/bin/env node
import { planPto } from "./orchestrator.js";
import { formatJson, formatPlan } from "./util/format.js";

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    prompt: "Plan my PTO in two weeks.",
    today: process.env.DEMO_TODAY || new Date().toISOString().slice(0, 10),
    profilePath: process.env.DEMO_PROFILE || "src/data/demo-profile.json",
    bookChoice: null,
    json: false,
    transcript: true,
    bookingMode: process.env.BOOKING_MODE || "dry-run"
  };

  const promptParts = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--today") {
      options.today = args[++index];
    } else if (arg === "--profile") {
      options.profilePath = args[++index];
    } else if (arg === "--book") {
      options.bookChoice = Number(args[++index]);
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--no-transcript") {
      options.transcript = false;
    } else if (arg === "--booking-mode") {
      options.bookingMode = args[++index];
    } else {
      promptParts.push(arg);
    }
  }

  if (promptParts.length > 0) {
    options.prompt = promptParts.join(" ");
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const plan = await planPto(options);
  process.stdout.write(options.json ? `${formatJson(plan)}\n` : `${formatPlan(plan, { includeTranscript: options.transcript })}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
