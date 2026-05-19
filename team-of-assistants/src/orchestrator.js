import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { researchClaw } from "./agents/research-claw.js";
import { financeClaw } from "./agents/finance-claw.js";
import { schedulingClaw } from "./agents/scheduling-claw.js";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseIntent(prompt) {
  const budgetMatch = /\$([0-9][0-9,]*)/.exec(prompt);
  const lower = prompt.toLowerCase();
  return {
    raw: prompt,
    relativeDays: lower.includes("two weeks") || lower.includes("2 weeks") ? 14 : 14,
    tripLengthDays: lower.includes("long weekend") ? 4 : 4,
    budgetOverride: budgetMatch ? Number(budgetMatch[1].replaceAll(",", "")) : null,
    wantsBooking: /\b(book|reserve|hold)\b/.test(lower)
  };
}

function mergeOption({ rank, candidate, finance, window }) {
  const confidence = candidate.researchScore + window.score + Math.min(5, finance.remaining / 200);
  return {
    rank,
    confidence: Number(confidence.toFixed(2)),
    destination: candidate,
    finance,
    window,
    handoff: {
      research: `${candidate.name}: ${candidate.weather.summary}; matched ${candidate.matchedInterests.join(", ")}.`,
      finance: `Estimated ${Math.round(finance.total)} USD, ${Math.round(finance.remaining)} USD under budget.`,
      scheduling: `${window.startDate} to ${window.endDate}; ${window.calendarSummary}.`
    }
  };
}

function buildBooking(option, mode) {
  const hash = createHash("sha256")
    .update(`${option.destination.id}:${option.window.startDate}:${option.finance.total}:${mode}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();

  return {
    optionRank: option.rank,
    mode,
    status: mode === "live" ? "ready for final human confirmation" : "dry-run hold created",
    confirmationCode: `PTO-${hash}`,
    nextStep: mode === "live"
      ? "Confirm traveler details and payment in the approved booking system."
      : "Set BOOKING_MODE=live only after wiring a real travel provider and human approval gate."
  };
}

export async function planPto({
  prompt,
  today,
  profilePath = "src/data/demo-profile.json",
  destinationsPath = "src/data/destinations.json",
  pricesPath = "src/data/prices.json",
  calendarPath = "src/data/calendar.json",
  bookChoice = null,
  bookingMode = "dry-run"
}) {
  const [profileInput, destinations, prices, calendar] = await Promise.all([
    readJson(profilePath),
    readJson(destinationsPath),
    readJson(pricesPath),
    readJson(calendarPath)
  ]);

  const intent = parseIntent(prompt);
  const profile = {
    ...profileInput,
    budgetUsd: intent.budgetOverride ?? profileInput.budgetUsd
  };

  const scheduling = await schedulingClaw({ calendar, today, intent });
  const [research, finance] = await Promise.all([
    researchClaw({ destinations, profile, intent }),
    financeClaw({ prices, profile, destinations, windows: scheduling.windows })
  ]);

  const financeByDestination = new Map(finance.options.map((item) => [item.destinationId, item]));
  const windowById = new Map(scheduling.windows.map((item) => [item.id, item]));
  const merged = research.candidates
    .map((candidate) => {
      const financeOption = financeByDestination.get(candidate.id);
      if (!financeOption || financeOption.budgetStatus !== "within budget") return null;
      const window = windowById.get(financeOption.windowId);
      if (!window) return null;
      return mergeOption({ rank: 0, candidate, finance: financeOption, window });
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((option, index) => ({ ...option, rank: index + 1 }));

  const selected = bookChoice ? merged.find((option) => option.rank === bookChoice) : null;

  return {
    prompt,
    today,
    profile,
    intent,
    transcript: [
      { speaker: "you", message: prompt },
      { speaker: "coordinator-claw", message: "I will split this between research, finance, and scheduling, then synthesize three bookable options." },
      { speaker: "research-claw", message: research.discordMessage },
      { speaker: "scheduling-claw", message: scheduling.discordMessage },
      { speaker: "finance-claw", message: finance.discordMessage },
      { speaker: "coordinator-claw", message: "I synced the findings and ranked the options by calendar fit, weather/interest match, and budget headroom." }
    ],
    agents: { research, finance, scheduling },
    options: merged,
    booking: selected ? buildBooking(selected, bookingMode) : null
  };
}
