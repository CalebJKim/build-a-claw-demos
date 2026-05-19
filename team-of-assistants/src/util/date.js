const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Expected date in YYYY-MM-DD format, got: ${value}`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function daysBetween(startDate, endDate) {
  return Math.round((parseDate(endDate).getTime() - parseDate(startDate).getTime()) / DAY_MS);
}

export function eachDate(startDate, endDateInclusive) {
  const start = parseDate(startDate);
  const end = parseDate(endDateInclusive);
  const dates = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(formatDate(cursor));
  }
  return dates;
}

export function weekdayName(dateString) {
  return parseDate(dateString).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC"
  });
}

export function isWeekend(dateString) {
  const day = parseDate(dateString).getUTCDay();
  return day === 0 || day === 6;
}

export function humanRange(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startText = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
  const endText = end.toLocaleDateString("en-US", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    timeZone: "UTC"
  });
  return `${startText}-${endText}`;
}
