import { humanRange } from "./date.js";

export function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Math.round(value));
}

export function formatPlan(plan, { includeTranscript = true } = {}) {
  const lines = [];

  if (includeTranscript) {
    lines.push("Discord demo transcript");
    lines.push("");
    for (const entry of plan.transcript) {
      lines.push(`**${entry.speaker}**: ${entry.message}`);
    }
    lines.push("");
  }

  lines.push(`PTO Team Recommendation for ${plan.profile.travelerName}`);
  lines.push(`Home airport: ${plan.profile.homeAirport} | Budget: ${money(plan.profile.budgetUsd)}`);
  lines.push("");

  for (const option of plan.options) {
    lines.push(
      `${option.rank}. ${option.destination.name} (${humanRange(option.window.startDate, option.window.endDate)})`
    );
    lines.push(
      `   Total: ${money(option.finance.total)} (${option.finance.budgetStatus}, ${money(option.finance.remaining)} under budget)`
    );
    lines.push(
      `   PTO: ${option.window.ptoDays} workdays | Calendar: ${option.window.calendarSummary}`
    );
    lines.push(
      `   Why it works: ${option.destination.why}`
    );
    lines.push(
      `   Logistics: ${option.destination.logistics}`
    );
    lines.push(
      `   Booking command: npm run demo -- "${plan.prompt}" --today ${plan.today} --book ${option.rank}`
    );
    lines.push("");
  }

  lines.push("Booking guardrail: this demo creates a dry-run hold unless BOOKING_MODE=live is explicitly set.");

  if (plan.booking) {
    lines.push("");
    lines.push(`Dry-run booking packet for option ${plan.booking.optionRank}`);
    lines.push(`Confirmation: ${plan.booking.confirmationCode}`);
    lines.push(`Status: ${plan.booking.status}`);
    lines.push(`Next step: ${plan.booking.nextStep}`);
  }

  return lines.join("\n");
}

export function formatJson(value) {
  return JSON.stringify(value, null, 2);
}
