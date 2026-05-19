import test from "node:test";
import assert from "node:assert/strict";
import { planPto } from "../src/orchestrator.js";

test("creates three PTO options under budget", async () => {
  const plan = await planPto({
    prompt: "Plan my PTO in two weeks.",
    today: "2026-05-14"
  });

  assert.equal(plan.options.length, 3);
  assert.equal(plan.options[0].destination.name, "Santa Fe, New Mexico");
  assert.ok(plan.options.every((option) => option.finance.total <= plan.profile.budgetUsd));
  assert.ok(plan.transcript.some((entry) => entry.speaker === "research-claw"));
  assert.ok(plan.transcript.some((entry) => entry.speaker === "finance-claw"));
  assert.ok(plan.transcript.some((entry) => entry.speaker === "scheduling-claw"));
});

test("booking is dry-run and deterministic", async () => {
  const plan = await planPto({
    prompt: "Plan my PTO in two weeks.",
    today: "2026-05-14",
    bookChoice: 1,
    bookingMode: "dry-run"
  });

  assert.equal(plan.booking.status, "dry-run hold created");
  assert.match(plan.booking.confirmationCode, /^PTO-[A-F0-9]{8}$/);
});
