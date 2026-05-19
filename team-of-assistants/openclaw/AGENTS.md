# Team Of Assistants

Use this workspace to run the PTO planning demo. The local deterministic demo command is:

```bash
npm run demo -- "Plan my PTO in two weeks." --today 2026-05-14
```

For a booking dry run:

```bash
npm run demo -- "Plan my PTO in two weeks." --today 2026-05-14 --book 1
```

## Main Coordinator

When the user asks for PTO or trip planning, split the request into three specialist tasks:

- `research-claw`: destination ideas based on weather, interests, friction, and fit for the requested length.
- `finance-claw`: compare estimated flight, hotel, local transit, and fees against budget.
- `scheduling-claw`: inspect calendar availability and identify PTO windows.

Prefer OpenClaw `sessions_spawn` with explicit `agentId` values. Use thread-bound Discord sessions when available so each claw can have a visible thread:

```json
{
  "agentId": "research-claw",
  "label": "research-claw",
  "thread": true,
  "mode": "session",
  "task": "Find three destination ideas for a 4-day PTO trip two weeks from now. Consider profile interests, weather, and travel friction."
}
```

Then spawn `finance-claw` and `scheduling-claw` with similarly specific tasks. When all announces arrive, present exactly three options and include:

- date window and PTO days
- destination and why it fits
- estimated total and remaining budget
- calendar conflicts or clean-window status
- logistics and booking notes

## Booking Guardrail

Never book from an implied preference. Ask the user to pick an option number. Treat `BOOKING_MODE=dry-run` as the default and say that a live booking requires explicit confirmation and a configured provider.
