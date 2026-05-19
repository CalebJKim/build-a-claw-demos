import assert from "node:assert/strict";
import test from "node:test";
import {
  collectBriefing,
  dateKeyForOffset,
  loadConfig,
  nextRunAt,
  renderDigest
} from "../src/briefing-core.mjs";

test("renders a concise demo briefing", async () => {
  const config = await loadConfig();
  const briefing = await collectBriefing(config, {
    demo: true,
    now: "2026-05-14T12:00:00.000Z"
  });
  const digest = renderDigest(briefing, config);

  assert.match(digest, /Morning Briefing/);
  assert.match(digest, /Weather:/);
  assert.match(digest, /Time-sensitive:/);
  assert.match(digest, /AI infrastructure:/);
  assert.match(digest, /No app to open/);
});

test("computes next run at configured wall-clock time", () => {
  const schedule = { time: "07:00", timezone: "America/Chicago" };
  const before = nextRunAt(new Date("2026-05-14T11:30:00.000Z"), schedule);
  const after = nextRunAt(new Date("2026-05-14T13:30:00.000Z"), schedule);

  assert.equal(before.toISOString(), "2026-05-14T12:00:00.000Z");
  assert.equal(after.toISOString(), "2026-05-15T12:00:00.000Z");
});

test("date offsets use the configured timezone", () => {
  const now = new Date("2026-05-14T03:00:00.000Z");

  assert.equal(dateKeyForOffset(now, "America/Chicago", 0), "2026-05-13");
  assert.equal(dateKeyForOffset(now, "America/Chicago", 1), "2026-05-14");
});
