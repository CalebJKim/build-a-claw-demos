# NemoClaw + OpenShell Setup

This repo is runnable locally without external services, then can be moved into a NemoClaw sandbox for the full Discord-hosted agent demo.

## 1. Run The Local Demo

```bash
npm run demo -- "Plan my PTO in two weeks." --today 2026-05-14
npm run demo -- "Plan my PTO in two weeks." --today 2026-05-14 --book 1
```

## 2. Prepare Discord

Create one Discord application/bot for the coordinator. Enable Message Content Intent. Invite it to your demo server with permissions to read messages, send messages, create public threads, and send messages in threads.

For a literal "one bot per claw" stage, create three more bots named `research-claw`, `finance-claw`, and `scheduling-claw`. The OpenClaw-native path is usually cleaner: one Discord bot fronts the coordinator, and OpenClaw sub-agent sessions create visible specialist threads.

## 3. Onboard NemoClaw

NemoClaw is alpha software, so keep this as a demo sandbox and avoid production data.

```bash
export NVIDIA_API_KEY="..."
export BRAVE_API_KEY="..."
export DISCORD_BOT_TOKEN="..."
export DISCORD_SERVER_ID="..."
export DISCORD_REQUIRE_MENTION=1

nemoclaw onboard
```

During onboarding:

- choose NVIDIA Endpoints or another configured inference provider
- enable Brave Search if you want live research
- enable Discord messaging
- choose the Discord network policy preset when prompted
- add Outlook or Google calendar policy only if you wire a real calendar provider

## 4. Add The Demo Workspace

Inside the sandbox, use `/sandbox/.openclaw/workspace/` as the shared writable path.

```bash
nemoclaw my-assistant connect
mkdir -p /sandbox/.openclaw/workspace/team-of-assistants
```

Then copy this repository into that workspace by your preferred file-sync path. The deterministic command should work from inside the sandbox once Node can see the repo:

```bash
cd /sandbox/.openclaw/workspace/team-of-assistants
npm run demo -- "Plan my PTO in two weeks." --today 2026-05-14
```

## 5. Apply The OpenClaw Overlay

Use `openclaw/openclaw.team-of-assistants.jsonc` as a config overlay for:

- Discord thread bindings
- `main`, `research-claw`, `finance-claw`, and `scheduling-claw` agent IDs
- `sessions_spawn` access from the coordinator
- bounded sub-agent concurrency and timeouts

In NemoClaw, `/sandbox/.openclaw/openclaw.json` is generated and can be made read-only. Patch through the host-side NemoClaw/OpenShell workflow rather than treating in-sandbox edits as durable.

## 6. Optional Custom Travel Policy

The installed NemoClaw CLI supports built-in policy presets through `nemoclaw <sandbox> policy-add`. Use built-ins for `discord`, `brave`, and `outlook` where possible.

For travel-specific APIs, `nemoclaw/policies/travel-demo.yaml` is a custom preset. Install it into the NemoClaw blueprint preset directory before onboarding, then select it with `policy-add`, or translate it to a dynamic OpenShell policy if your runtime supports direct policy files.

## 7. Demo Script

In Discord:

```text
@PTO Team Plan my PTO in two weeks.
```

Expected narrative:

1. Coordinator says it is waking the three claws.
2. Research reports destination fit and weather.
3. Scheduling reports the best PTO windows.
4. Finance reports budget checks.
5. Coordinator presents three ranked trip options.
6. User says "Book option 1."
7. Coordinator creates a dry-run booking packet unless live booking has been explicitly enabled.
