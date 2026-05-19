# Team Of Assistants

Demo scaffold for: "Your Own Team of Assistants." A coordinator claw lives in Discord and delegates to three specialist claws:

- `research-claw`: destination ideas from weather and interests
- `finance-claw`: flight/hotel estimates against budget
- `scheduling-claw`: calendar windows for PTO

The repo has a deterministic local demo plus NemoClaw/OpenShell templates so the same flow can be moved into a sandboxed OpenClaw setup.

## Quick Start

```bash
npm test
npm run demo -- "Plan my PTO in two weeks." --today 2026-05-14
npm run demo -- "Plan my PTO in two weeks." --today 2026-05-14 --book 1
```

The local demo uses fixtures in `src/data/` so the presentation is reliable without travel, weather, calendar, or booking API keys.

## Discord Runner

The no-dependency Discord runner uses Node's built-in `WebSocket` and `fetch`.

```bash
export DISCORD_BOT_TOKEN="..."
export DISCORD_REQUIRE_MENTION=1
npm run discord
```

In Discord:

```text
@PTO Team Plan my PTO in two weeks.
```

The bot replies with the synthesized trip plan. This is useful for the demo booth. For the deeper NemoClaw version, let NemoClaw/OpenClaw own the Discord channel and sub-agent thread bindings.

## NemoClaw / OpenShell

The integration files are:

- `openclaw/SOUL.md`: coordinator identity and booking guardrail
- `openclaw/AGENTS.md`: task delegation instructions for OpenClaw
- `openclaw/openclaw.team-of-assistants.jsonc`: config overlay for Discord thread bindings and specialist agents
- `nemoclaw/policies/travel-demo.yaml`: custom travel/weather/calendar egress preset
- `nemoclaw/setup-nemoclaw.md`: sandbox setup runbook

NemoClaw runs OpenClaw inside OpenShell containers and manages messaging channels such as Discord through OpenShell-managed processes. OpenClaw sub-agents use `sessions_spawn`; Discord currently supports persistent thread-bound sub-agent sessions, which maps well to "each claw answers when called."

## Demo Flow

1. User: "Plan my PTO in two weeks."
2. Coordinator wakes research, finance, and scheduling.
3. Research ranks destinations by interest and weather fit.
4. Scheduling finds the best PTO windows.
5. Finance compares estimated flight, hotel, transit, and fees against budget.
6. Coordinator presents three complete options.
7. User picks an option.
8. Demo creates a dry-run booking packet. Live booking should require explicit human confirmation and a real provider integration.

## Configuration

Edit `src/data/demo-profile.json` for home airport, budget, interests, party size, and timezone. The default profile is intentionally simple and demo-friendly.

Use `--today YYYY-MM-DD` to keep the phrase "in two weeks" stable during rehearsals.

## Notes

- No external npm packages are required.
- The booking step is dry-run by default.
- The fixture data is not live pricing; it is designed to prove the orchestration and handoff.
- NemoClaw is alpha software, so keep real credentials and booking actions behind explicit guardrails.

## OpenClaw Demo Pack

This directory now follows the repo demo-pack format. It has its own manifest, OpenClaw profile, gateway port, report port, generated workspaces, reset flow, and chat wrapper.

- Profile: `pto-demo`
- Gateway: `18901`
- Report server: `19016`
- Local model: `ollama/qwen3.6:35b-a3b`
- Chat-facing command: `bin/team-of-assistants-chat --prompt "<ask>" --async`

Standard run flow:

```bash
./scripts/doctor
./scripts/bootstrap
./scripts/start
./scripts/run-sample
```

To use the OpenClaw UI, start the demo and open the profile dashboard:

```bash
./scripts/start
openclaw --profile pto-demo dashboard
```

Then ask for PTO planning in chat. The main agent routes to the packaged workflow and returns a status/report URL.

Reset between demos:

```bash
./scripts/reset
```

Generated state lives under `runs/`, `input/`, `workspaces/`, `.generated/`, `.archive/`, and `openclaw/agents/`. Do not commit real travel profiles, Discord tokens, generated reports, or live booking data.
