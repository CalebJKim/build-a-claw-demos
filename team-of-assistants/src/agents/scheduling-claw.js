import { addDays, eachDate, formatDate, isWeekend, parseDate, weekdayName } from "../util/date.js";

function eventMap(events) {
  const map = new Map();
  for (const event of events) {
    const list = map.get(event.date) || [];
    list.push(event);
    map.set(event.date, list);
  }
  return map;
}

function scoreWindow(dates, eventsByDate) {
  let score = 12;
  const conflicts = [];
  let ptoDays = 0;

  for (const date of dates) {
    if (!isWeekend(date)) ptoDays += 1;
    for (const event of eventsByDate.get(date) || []) {
      conflicts.push(event);
      score -= event.movable ? 1 : 5;
    }
  }

  score -= Math.max(0, ptoDays - 2) * 1.5;
  if (dates[0].endsWith("-04") || weekdayName(dates[0]) === "Thu") score += 1;

  return { score, conflicts, ptoDays };
}

export async function schedulingClaw({ calendar, today, intent }) {
  const anchor = addDays(parseDate(today), intent.relativeDays);
  const eventsByDate = eventMap(calendar.events);
  const windows = [];

  for (let offset = -1; offset <= 15; offset += 1) {
    const start = addDays(anchor, offset);
    const startDay = start.getUTCDay();
    if (![3, 4, 5].includes(startDay)) continue;

    const lengthDays = startDay === 5 ? 4 : intent.tripLengthDays;
    const end = addDays(start, lengthDays - 1);
    const dates = eachDate(formatDate(start), formatDate(end));
    const scored = scoreWindow(dates, eventsByDate);
    windows.push({
      id: `${formatDate(start)}_${formatDate(end)}`,
      startDate: formatDate(start),
      endDate: formatDate(end),
      ptoDays: scored.ptoDays,
      conflicts: scored.conflicts,
      score: scored.score,
      calendarSummary: scored.conflicts.length === 0
        ? "clean window"
        : `${scored.conflicts.length} conflict(s), ${scored.conflicts.filter((event) => event.movable).length} movable`
    });
  }

  const ranked = windows
    .sort((a, b) => b.score - a.score || a.ptoDays - b.ptoDays)
    .slice(0, 3);

  return {
    agent: "scheduling-claw",
    summary: `Checked calendar windows around ${formatDate(anchor)} in ${calendar.timezone}.`,
    windows: ranked,
    discordMessage: [
      `I found ${ranked.length} workable PTO windows around ${formatDate(anchor)}.`,
      `Best window is ${ranked[0].startDate} to ${ranked[0].endDate}: ${ranked[0].calendarSummary}, ${ranked[0].ptoDays} PTO workdays.`
    ].join(" ")
  };
}
