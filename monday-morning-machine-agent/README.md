# Monday Morning Machine

> **Try it:** "Get me ready for my week."

OpenClaw demo pack for turning one sentence into a complete weekly operating brief with calendar prep, inbox triage, world-check research, and mock-safe actions taken.

Audience: anyone who works: professionals, freelancers, managers, founders.

Ask: "Get me ready for my week."

Workflow shape: scheduled trigger -> parallel live data pulls -> synthesis -> personalized output -> real action taken.

## What It Shows

The demo starts from one natural-language request and produces:

- a week-at-a-glance brief
- meeting-by-meeting prep
- under-prepared meeting flags
- inbox triage from the last 72 hours
- draft replies to urgent threads
- source-visible world-check findings
- a prioritized weekly task list
- mock-safe receipts for emails sent, calendar blocks created, and notes posted

The intended wow moments are sequenced. First, the world check surfaces something the user did not know to look for: a competitor move and sector news tied to this week's meetings. Second, the output ends with "Here's what I already did on your behalf."

## Architecture

This is a host-native OpenClaw demo pack. It does not ship OpenClaw in a container. The target device provides OpenClaw, Ollama, and the local model; this directory provides a sterile OpenClaw profile, agent instructions, mock integration tools, reset/start scripts, and the repeatable workflow runner.

The primary configuration contract is `demo.config.json`. Scripts read profile names, ports, model IDs, agent definitions, generated paths, and sample prompts from the manifest so the demo can be moved to another Spark or OpenClaw device without path edits.

Default profile: `monday-demo`

Default model: `ollama/qwen3.6:35b-a3b`

Default gateway port: `18895`

Default report server port on the device: `19004`

Default local tunnel port: `19005`

The demo has six claws:

- `main`: chat-facing operator. Routes "Get me ready for my week" into the packaged workflow.
- `calendar`: reads the week, identifies important meetings, and flags prep gaps.
- `inbox`: reads the last 72 hours of mail, finds urgent threads, commitments, and draft replies.
- `world`: searches source-visible external signals relevant to the week's meetings.
- `prep`: synthesizes calendar, inbox, and world findings into the weekly brief.
- `executor`: creates mock-safe receipts for approved replies, focus blocks, note posts, and Slack posts.

The packaged runner in `src/run.js` is the repeatable tool that OpenClaw calls. It runs calendar and inbox pulls in parallel, fans out world-search queries, merges the specialist outputs, writes the weekly brief, and executes mock actions through `tools/mock-action-api`.

## What Is Included

- `demo.config.json` - demo-pack manifest: profile, ports, model, agents, required tools, generated paths, and standard commands.
- `agents/*/AGENTS.md` and `agents/*/SOUL.md` - registered OpenClaw agent workspaces and specialist instructions.
- `bin/monday-morning-machine` - dependency-free Node runner entrypoint.
- `bin/monday-morning-machine-chat` - wrapper for OpenClaw dashboard/chat usage.
- `bin/monday-morning-machine-job` - detached async background job runner used by chat.
- `tools/mock-calendar` - local calendar integration mock.
- `tools/mock-inbox` - local inbox integration mock.
- `tools/mock-world-search` - source-visible world-search mock.
- `tools/mock-action-api` - mock-safe action API that writes receipts instead of touching real accounts.
- `data/mock-calendar-week.json` - seeded messy week for Monday, May 18, 2026.
- `data/mock-inbox-last72h.json` - seeded recent inbox.
- `data/mock-world-corpus.json` - seeded external news/search corpus.
- `scripts/doctor`, `scripts/bootstrap`, `scripts/start`, `scripts/run-sample`, `scripts/reset`, `scripts/uninstall` - standard repo demo-pack command surface.

Generated files are intentionally ignored by git:

- `runs/`
- `input/`
- `workspaces/`
- `.generated/`
- `.archive/`
- `openclaw/agents/`

Do not commit generated reports, mock action receipts from real user prompts, OpenClaw state, tokens, or real calendar/email exports.

## OpenClaw Features Used

- Isolated OpenClaw profile: `monday-demo`.
- Registered claws/agents with separate workspaces and prompts.
- Local model provider configuration for Ollama.
- Dashboard/chat entrypoint through the `main` claw.
- Tool invocation through local wrappers and integration mocks.
- Async background execution so the chat returns a status URL quickly.
- Local report hosting so generated artifacts can be opened through an SSH tunnel.

## Agentic Concepts Demonstrated

- Scheduled trigger shape: the workflow can be launched by the one-line ask or scheduled externally for Monday morning.
- Parallel data pulls: calendar and inbox are pulled concurrently, then world-search queries fan out from the combined context.
- Memory/context: the mock calendar includes relationship notes, sector focus, and work-pattern memory.
- Source-visible research: world-check results include query, source, published time, URL, and why it matters.
- Multi-agent synthesis: specialist outputs collapse into one coherent weekly brief.
- Action execution: the executor writes receipts for mock email sends, calendar focus blocks, note posting, and Slack posting.
- Approval-safe behavior: the demo uses mock-safe approvals by default; `--no-actions` switches to planned-only mode.

## Execution Flow

```text
OpenClaw dashboard or scheduled trigger
      |
      v
main claw
      |
      v
monday-morning-machine-chat
      |
      v
calendar      inbox
   |            |
   v            v
calendar flags  urgent threads
      \        /
       \      /
        v    v
      world searches
           |
           v
      prep writer
           |
           v
        executor
           |
           v
weekly brief, email drafts, focus blocks, note/slack receipts
```

## Mock Integrations

This demo uses local mocks by default so it can run safely on any demo device:

```bash
./tools/mock-calendar week
./tools/mock-inbox last72
./tools/mock-world-search search "energy grid security vendor reliability"
```

The action API writes receipts to the run directory:

```bash
./tools/mock-action-api send-email <out-dir> '{"to":"example@example.com"}'
```

To wire real integrations later, keep the same output shape:

- calendar reader returns week events
- inbox reader returns recent threads
- world search returns source-visible hits
- action API requires approval and returns receipts

## Outputs

Each run writes a timestamped directory under `runs/` unless `--out` is provided.

Generated files include:

- `index.html` - browser report
- `weekly-brief.md` - the main audience-facing brief
- `calendar-prep.md` - meeting briefs and under-prepared flags
- `inbox-triage.md` - urgent threads and draft replies
- `world-check.md` - source-visible world-search findings
- `actions-taken.md` - mock-safe "what I already did" receipts
- `analysis.json` - structured machine-readable output
- `tool-responses/` - raw mock calendar, inbox, and world-search responses
- `actions/mock-action-ledger.json` - action receipts
- `actions/draft-emails/` - individual sent-reply receipts
- `actions/calendar-blocks/` - focus-block receipts

## Prerequisites

On the target device:

- OpenClaw installed and on `PATH`
- Node.js `22.16.0` or newer
- Ollama installed and running
- Ollama model `qwen3.6:35b-a3b` installed
- `curl`
- `python3`

Check the model with:

```bash
ollama list
```

Install it if needed:

```bash
ollama pull qwen3.6:35b-a3b
```

## Setup On A New Device

From this repo:

```bash
cd monday-morning-machine-agent
./scripts/doctor
./scripts/bootstrap
./scripts/start
```

`bootstrap` creates or updates only the `monday-demo` OpenClaw profile. It does not modify the user's default OpenClaw profile.

## Run The Sample

Fast deterministic smoke test:

```bash
./scripts/run-sample --skip-model
```

Run without mock action execution:

```bash
./scripts/run-sample --skip-model --no-actions
```

Async chat-wrapper smoke test:

```bash
./bin/monday-morning-machine-chat --async --skip-model
```

Full local-model run:

```bash
./scripts/run-sample
```

The command prints the generated report path. Open `index.html` from the run directory, or use the report server started by `./scripts/start`.

## Run Through OpenClaw UI

Start services:

```bash
./scripts/start
openclaw --profile monday-demo dashboard --no-open
```

Use the printed dashboard token to open the UI.

Ask:

```text
Get me ready for my week.
```

The chat-facing claw should return a status link, weekly brief link, and actions-taken link. The async wrapper is used because the workflow includes multiple tool pulls, synthesis, and action receipts.

## Remote UI From A Laptop

If the demo runs on a Spark or another remote device, tunnel both the OpenClaw gateway and report server:

```bash
ssh -L 18895:127.0.0.1:18895 -L 19005:127.0.0.1:19004 <user>@<device>
```

Then open the dashboard and generated reports through localhost on the laptop.

## Reset For A Fresh Run

```bash
./scripts/reset
```

This archives `runs/`, `input/`, and `.generated/` into `.archive/<timestamp>/`, restarts the profile gateway if available, and keeps the OpenClaw profile installed.

For a fully fresh uninstall:

```bash
./scripts/uninstall
```

Use `./scripts/uninstall --yes` only in automation.

## Demo Talk Track

1. Type only: "Get me ready for my week."
2. Show the status page while the claws run.
3. Open `world-check.md` first and point to the competitor/sector hit the user did not ask for.
4. Open `weekly-brief.md` and read the Tuesday product-review brief out loud.
5. End on `actions-taken.md`: replies sent in demo mode, focus blocks created, note/Slack posted.

## Known Limits

- Calendar, inbox, world search, Slack, notes, and email actions are mocked by default.
- Mock actions are safe receipts, not real sends. This is intentional for demo portability.
- The seeded week is Monday, May 18, 2026 through Friday, May 22, 2026.
- The world-check corpus is seeded, not live internet. Swap `tools/mock-world-search` with a real search gateway to make Claw C fully live.
- Real email/calendar connectors should require explicit approval before sends or calendar writes.