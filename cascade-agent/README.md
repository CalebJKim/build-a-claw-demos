# The Cascade

> **Try it:** "Press 17 just went down. Figure out what just happened to the rest of my week."

OpenClaw demo pack for showing how one machine downtime event turns into a full-week production, cost, reroute, and customer-communication problem.

Audience: plant managers, operations directors, and anyone who has watched one problem become five problems by end of shift.

Ask: "A machine goes down. Figure out what just happened to the rest of my week."

Workflow shape: event trigger -> parallel impact analysis -> re-optimization -> proactive communication.

## What It Shows

The demo triggers a live downtime event for `PRESS-17` and produces:

- a live ticking downtime cost clock
- a blast radius map across jobs, downstream stations, and customers
- ranked rerouting options with cost, lead-time, overtime, and weekend-shift impact
- an approved recommendation
- customer-specific notification drafts
- mock-safe send receipts for the notifications

The intended wow moment is the customer notification. The machine goes down, and within the run there is already a specific message to the affected customer with order number, old commit, new commit, explanation, and offer to discuss.

## Architecture

This is a host-native OpenClaw demo pack. It does not ship OpenClaw in a container. The target device provides OpenClaw, Ollama, and the local model; this directory provides a sterile OpenClaw profile, agent instructions, mocked plant/event/customer tools, and reset/start scripts.

The primary configuration contract is `demo.config.json`. Scripts read profile names, ports, model IDs, agent definitions, generated paths, and sample prompts from the manifest so the demo can be moved to another Spark or OpenClaw device without path edits.

Default profile: `cascade-demo`

Default model: `ollama/qwen3.6:35b-a3b`

Default gateway port: `18896`

Default report server port on the device: `19006`

Default local tunnel port: `19007`

The demo has five claws:

- `main`: chat-facing operator. Routes downtime prompts into the packaged workflow.
- `impact`: maps blast radius: running jobs, starving downstream stations, affected customers, and commit-date risk.
- `rerouter`: evaluates sister machines, alternate routing, overtime, weekend recovery, cost, and lead-time impact.
- `clock`: calculates the live downtime cost per minute from schedule, margin, and idle downstream labor.
- `communicator`: takes the best reroute and sends mock-safe customer notifications.

The packaged runner in `src/run.js` is the repeatable tool OpenClaw calls. It triggers the mock downtime event, runs impact/reroute/clock lanes in parallel, selects the best reroute, writes customer communications through `tools/mock-customer-comms`, and renders an HTML report with a live JavaScript cost clock.

## What Is Included

- `demo.config.json` - demo-pack manifest: profile, ports, model, agents, required tools, generated paths, and standard commands.
- `agents/*/AGENTS.md` and `agents/*/SOUL.md` - registered OpenClaw agent workspaces and specialist instructions.
- `bin/cascade` - dependency-free Node runner entrypoint.
- `bin/cascade-chat` - wrapper for OpenClaw dashboard/chat usage.
- `bin/cascade-job` - detached async background job runner used by chat.
- `tools/mock-downtime-event` - local downtime trigger tool.
- `tools/mock-customer-comms` - mock-safe customer notification send/draft API.
- `data/plant-state.json` - seeded plant schedule, machines, stations, jobs, margins, and customer contacts.
- `scripts/doctor`, `scripts/bootstrap`, `scripts/start`, `scripts/run-sample`, `scripts/reset`, `scripts/uninstall` - standard repo demo-pack command surface.

Generated files are intentionally ignored by git:

- `runs/`
- `input/`
- `workspaces/`
- `.generated/`
- `.archive/`
- `openclaw/agents/`

Do not commit generated reports, customer messages from real data, OpenClaw state, tokens, or plant/customer exports.

## OpenClaw Features Used

- Isolated OpenClaw profile: `cascade-demo`.
- Registered claws/agents with separate workspaces and prompts.
- Local model provider configuration for Ollama.
- Dashboard/chat entrypoint through the `main` claw.
- Tool invocation through local wrappers and mock plant/customer tools.
- Async background execution so the chat returns a status URL quickly.
- Local report hosting so the live clock and generated artifacts can be opened through an SSH tunnel.

## Agentic Concepts Demonstrated

- Event trigger: the workflow starts from a downtime event, not a file upload.
- Parallel impact analysis: impact tracing, rerouting, and cost-clock calculation happen at the same time.
- Re-optimization: the rerouter ranks alternate machines and recovery strategies.
- Live operational metric: the HTML report keeps the downtime cost moving on screen.
- Proactive communication: the communicator sends customer-specific messages before the customer escalates.
- Mock-safe action receipts: customer sends are simulated, auditable, and safe for portable demos.

## Execution Flow

```text
OpenClaw dashboard or live event trigger
      |
      v
main claw
      |
      v
cascade-chat
      |
      v
mock-downtime-event
      |
      v
impact tracer     rerouter     clock
      \              |          /
       \             |         /
        v            v        v
            recommendation
                  |
                  v
            communicator
                  |
                  v
live cost clock, blast radius, reroute plan, customer sends
```

## Mock Integrations

This demo uses local mocks by default:

```bash
./tools/mock-downtime-event trigger PRESS-17 9
./tools/mock-customer-comms send <out-dir> '{"to":"customer@example.com"}'
```

To wire real plant systems later, keep the same output shape:

- downtime event returns machine, detected time, repair estimate, and plant state reference
- plant state returns machines, schedule, jobs, downstream stations, margins, and customers
- customer comms API requires approval and returns send/draft receipts

## Outputs

Each run writes a timestamped directory under `runs/` unless `--out` is provided.

Generated files include:

- `index.html` - live browser report with ticking cost clock
- `downtime-event.md` - triggered event details
- `blast-radius.md` - affected jobs, stations, and customers
- `reroute-options.md` - ranked reroute options and recommendation
- `cost-clock.md` - cost calculation and projected exposure
- `customer-notifications.md` - customer-specific messages and receipts
- `analysis.json` - structured machine-readable output
- `tool-responses/downtime-event.json` - raw mock event payload
- `customer-comms/customer-comms-ledger.json` - mock send/draft receipts
- `customer-comms/messages/` - individual customer message files

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
cd cascade-agent
./scripts/doctor
./scripts/bootstrap
./scripts/start
```

`bootstrap` creates or updates only the `cascade-demo` OpenClaw profile. It does not modify the user's default OpenClaw profile.

## Run The Sample

Fast deterministic smoke test:

```bash
./scripts/run-sample --skip-model
```

Draft messages without mock send receipts:

```bash
./scripts/run-sample --skip-model --no-send
```

Async chat-wrapper smoke test:

```bash
./bin/cascade-chat --async --skip-model
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
openclaw --profile cascade-demo dashboard --no-open
```

Use the printed dashboard token to open the UI.

Ask:

```text
Press 17 just went down. Figure out what just happened to the rest of my week.
```

The chat-facing claw should return a status link, live report link, blast-radius link, reroute-options link, and customer-notifications link.

## Remote UI From A Laptop

If the demo runs on a Spark or another remote device, tunnel both the OpenClaw gateway and report server:

```bash
ssh -L 18896:127.0.0.1:18896 -L 19007:127.0.0.1:19006 <user>@<device>
```

Then open the dashboard and generated report through localhost on the laptop.

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

1. Trigger the event live: "Press 17 just went down."
2. Open the status page while the claws run.
3. Open the live report and point to the cost clock first.
4. Show blast radius: current job, downstream starvation, affected customers.
5. Show the reroute recommendation and explain the tradeoff.
6. End on `customer-notifications.md` and read one customer message out loud.

## Known Limits

- Plant data, downtime trigger, and customer sends are mocked by default.
- The cost clock is calculated from seeded schedule/margin/labor data and rendered live in the browser.
- Mock sends are safe receipts, not real customer emails.
- The seeded event is tuned for `PRESS-17`; other machine IDs need additional plant-state data.
- Real MES/ERP/email integrations should require explicit approval before customer sends.