# The Downtime Clock

> **Try it:** "Machine 4 just went down. What is this actually costing me."

OpenClaw demo pack for turning a machine-down event into a live executive cost clock with cascade, repair break-even, and historical context.

Audience: CFOs, plant controllers, and executives who hear "we had some downtime this week" without enough financial detail.

Ask: "Machine 4 just went down. What is this actually costing me."

Workflow shape: single event trigger -> real-time calculation -> live dashboard -> escalating urgency.

## What It Shows

The demo triggers a Machine 4 downtime event and produces:

- a live ticking cost clock, front and center
- revenue at risk from actual scheduled jobs and margins
- downstream cascade cost as station buffers deplete
- repair-cost break-even that changes state on screen
- historical context for Machine 4 this quarter and annualized downtime cost

The intended wow moment is the break-even line. The clock crosses the repair cost while the audience is watching, and the screen changes. That makes the cost of waiting for an end-of-shift damage report visible.

The live dashboard uses compressed demo time: one real second equals one downtime minute. This lets the break-even moment happen during a short live demo while preserving downtime-minute math in the displayed calculations.

## Architecture

This is a host-native OpenClaw demo pack. It does not ship OpenClaw in a container. The target device provides OpenClaw, Ollama, and the local model; this directory provides a sterile OpenClaw profile, specialist agent instructions, seeded production/maintenance/history data, a mock downtime data tool, and repeatable scripts.

The primary configuration contract is `demo.config.json`. Scripts read profile names, ports, model IDs, agent definitions, generated paths, and sample prompts from the manifest so the demo can be moved to another Spark or OpenClaw device without path edits.

Default profile: `downtime-clock-demo`

Default model: `ollama/qwen3.6:35b-a3b`

Default gateway port: `18900`

Default report server port on the device: `19014`

Default local tunnel port: `19015`

The demo has five claws:

- `main`: chat-facing operator. Routes Machine 4 downtime prompts into the packaged workflow.
- `revenue`: pulls the production schedule and calculates margin at risk from actual jobs, throughput, and contribution margin.
- `cascade`: tracks downstream station buffer depletion and adds idle labor cost as stations starve.
- `comparator`: compares accumulating downtime loss against parts, labor, expedite, and outside-service repair cost.
- `historian`: puts the current event in context: quarter count, average repair time, annualized downtime cost, and rebuild payback.

The packaged runner in `src/run.js` is the repeatable tool OpenClaw calls. It pulls mock downtime data, runs revenue/cascade/history lanes concurrently, calculates repair break-even, optionally polishes the executive paragraph with the local Ollama model, and renders markdown plus a live HTML dashboard.

## What Is Included

- `demo.config.json` - demo-pack manifest: profile, ports, model, agents, required tools, generated paths, and standard commands.
- `agents/*/AGENTS.md` and `agents/*/SOUL.md` - registered OpenClaw agent workspaces and specialist instructions.
- `bin/downtime-clock` - dependency-free Node runner entrypoint.
- `bin/downtime-clock-chat` - wrapper for OpenClaw dashboard/chat usage.
- `bin/downtime-clock-job` - detached async background job runner used by chat.
- `tools/mock-downtime-clock-data` - local production schedule, cascade, repair, and history mock.
- `data/downtime-clock-seed.json` - seeded Machine 4 event, jobs, downstream stations, repair estimate, and history.
- `scripts/doctor`, `scripts/bootstrap`, `scripts/start`, `scripts/run-sample`, `scripts/reset`, `scripts/uninstall` - standard repo demo-pack command surface.

Generated files are intentionally ignored by git:

- `runs/`
- `input/`
- `workspaces/`
- `.generated/`
- `.archive/`
- `openclaw/agents/`

Do not commit generated reports, real schedules, real maintenance data, OpenClaw state, tokens, or real plant/customer data.

## OpenClaw Features Used

- Isolated OpenClaw profile: `downtime-clock-demo`.
- Registered claws/agents with separate workspaces and prompts.
- Local model provider configuration for Ollama.
- Dashboard/chat entrypoint through the `main` claw.
- Tool invocation through local wrappers and the `mock-downtime-clock-data` tool.
- Async background execution so the chat can return a status URL quickly.
- Local report hosting so the live clock can be opened through an SSH tunnel.

## Agentic Concepts Demonstrated

- Event trigger: the workflow starts from "Machine 4 just went down."
- Real-time calculation: the generated HTML keeps calculating accumulated cost every second.
- Actual-margin accounting: revenue at risk comes from jobs, throughput, and contribution margin, not a flat downtime rate.
- Cascade acceleration: downstream idle labor only enters the clock when buffers deplete.
- Break-even comparator: the repair cost line is calculated and shown as a live threshold.
- Historical context: the historian reframes the event as a recurring capital/equipment decision.

## Execution Flow

```text
OpenClaw dashboard
      |
      v
main claw
      |
      v
downtime-clock-chat
      |
      v
revenue calculator     cascade tracker     historian
        \                    |              /
         \                   |             /
          v                  v            v
                comparator / break-even
                       |
                       v
live clock, cascade tracker, repair threshold, machine history
```

## Mock Integration

This demo uses deterministic local mocks by default:

```bash
./tools/mock-downtime-clock-data event MACHINE-4
./tools/mock-downtime-clock-data history MACHINE-4
```

The mock returns:

- current Machine 4 downtime event and detected time
- actual scheduled jobs, contribution margin, throughput, and commit risk
- downstream station buffer minutes and idle labor cost
- repair estimate: parts, labor, expedite, outside service, estimated repair time
- Machine 4 history: prior events, annualized downtime cost, rebuild cost, and rebuild lead time

To wire real systems later, keep the same output shape and replace `tools/mock-downtime-clock-data` with adapters for MES scheduling, ERP margin data, labor/cell staffing, maintenance/CMMS, and machine history.

## Outputs

Each run writes a timestamped directory under `runs/` unless `--out` is provided.

Generated files include:

- `index.html` - live dashboard with ticking cost clock
- `executive-summary.md` - CFO-ready summary and key numbers
- `revenue-clock.md` - job-by-job margin-at-risk calculation
- `cascade-tracker.md` - downstream buffer depletion and labor-cost triggers
- `break-even.md` - repair-cost comparison and rate timeline
- `history.md` - Machine 4 downtime history and rebuild payback
- `analysis.json` - structured machine-readable output
- `tool-responses/downtime-clock-data.json` - raw mock data payload

## Prerequisites

On the target device:

- OpenClaw installed and on `PATH`
- Node.js `22.14.0` or newer
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
cd downtime-clock-agent
./scripts/doctor
./scripts/bootstrap
./scripts/start
```

`bootstrap` creates or updates only the `downtime-clock-demo` OpenClaw profile. It does not modify the user's default OpenClaw profile.

## Run The Sample

Fast deterministic smoke test:

```bash
./scripts/run-sample --skip-model
```

Async chat-wrapper smoke test:

```bash
./bin/downtime-clock-chat --async --skip-model
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
openclaw --profile downtime-clock-demo dashboard --no-open
```

Use the printed dashboard token to open the UI.

Ask:

```text
Machine 4 just went down. What is this actually costing me.
```

The chat-facing claw should return a status link, live dashboard link, executive summary link, break-even link, revenue clock link, cascade tracker link, and history link.

## Remote UI From A Laptop

If the demo runs on a Spark or another remote device, tunnel both the OpenClaw gateway and report server:

```bash
ssh -L 18900:127.0.0.1:18900 -L 19015:127.0.0.1:19014 <user>@<device>
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

## Known Limits

- The plant schedule, labor rates, repair estimate, and history are synthetic and deterministic by design.
- The browser dashboard uses compressed demo time, so one real second represents one downtime minute.
- The demo does not write to MES, ERP, CMMS, or finance systems.
- A real integration should add approval gates before triggering maintenance escalation or customer/finance notifications.