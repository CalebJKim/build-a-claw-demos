# The Pre-Flight

> **Try it:** "Before this job runs, tell me if it's going to go well."

OpenClaw demo pack for deciding whether a manufacturing job should run now, wait for better conditions, or run with added controls before the first part is cut.

Audience: quality managers, production planners, and ops leaders who are tired of finding out a job went wrong after it already ran.

Ask: "Before this job runs, tell me if it's going to go well."

Workflow shape: job intake -> multi-source context pull -> risk synthesis -> go/no-go recommendation with conditions.

## What It Shows

The demo runs two seeded pre-flight scenarios side by side:

- `wait-smart`: current first-pass yield is 62%, waiting four hours raises it to 84%, and the rework savings beat the delay cost.
- `run-now-smart`: current first-pass yield is 78%, waiting four hours raises it to 91%, but the schedule cost is much higher than the quality savings, so the right call is to run now with an inspection gate.

The intended wow moment is the comparison. It does not just say "62% likely to pass." It says, "62% now or 84% in four hours, and here is the math on which one costs more."

## Architecture

This is a host-native OpenClaw demo pack. It does not ship OpenClaw in a container. The target device provides OpenClaw, Ollama, and the local model; this directory provides a sterile OpenClaw profile, specialist agent instructions, seeded job/machine/context data, a mock pre-flight data tool, and repeatable scripts.

The primary configuration contract is `demo.config.json`. Scripts read profile names, ports, model IDs, agent definitions, generated paths, and sample prompts from the manifest so the demo can be moved to another Spark or OpenClaw device without path edits.

Default profile: `preflight-demo`

Default model: `ollama/qwen3.6:35b-a3b`

Default gateway port: `18898`

Default report server port on the device: `19010`

Default local tunnel port: `19011`

The demo has five claws:

- `main`: chat-facing operator. Routes pre-flight prompts into the packaged workflow.
- `job`: scores inherent job difficulty from geometry, tolerances, material cert data, quantity, and customer quality requirements.
- `machine`: checks assigned-machine condition, calibration age, open work orders, and observed first-pass yield on similar jobs.
- `context`: reads shop load, operator experience, environment, and better machine/operator availability inside four hours.
- `forecaster`: synthesizes all inputs into yield probability, confidence, ranked factors, schedule/rework math, and the final go/no-go recommendation.

The packaged runner in `src/run.js` is the repeatable tool OpenClaw calls. It pulls seeded mock data, runs job/machine/context analysis lanes concurrently, merges them in the forecaster, optionally polishes the summary with the local Ollama model, and renders markdown plus an HTML report.

## What Is Included

- `demo.config.json` - demo-pack manifest: profile, ports, model, agents, required tools, generated paths, and standard commands.
- `agents/*/AGENTS.md` and `agents/*/SOUL.md` - registered OpenClaw agent workspaces and specialist instructions.
- `bin/pre-flight` - dependency-free Node runner entrypoint.
- `bin/pre-flight-chat` - wrapper for OpenClaw dashboard/chat usage.
- `bin/pre-flight-job` - detached async background job runner used by chat.
- `tools/mock-preflight-data` - local job/machine/context data source mock.
- `data/preflight-seed.json` - seeded scenarios, cost assumptions, machine conditions, operators, and drag factors.
- `scripts/doctor`, `scripts/bootstrap`, `scripts/start`, `scripts/run-sample`, `scripts/reset`, `scripts/uninstall` - standard repo demo-pack command surface.

Generated files are intentionally ignored by git:

- `runs/`
- `input/`
- `workspaces/`
- `.generated/`
- `.archive/`
- `openclaw/agents/`

Do not commit generated reports, real job travelers, real QMS/MES exports, OpenClaw state, tokens, or real customer/plant data.

## OpenClaw Features Used

- Isolated OpenClaw profile: `preflight-demo`.
- Registered claws/agents with separate workspaces and prompts.
- Local model provider configuration for Ollama.
- Dashboard/chat entrypoint through the `main` claw.
- Tool invocation through local wrappers and the `mock-preflight-data` tool.
- Async background execution so the chat can return a status URL quickly.
- Local report hosting so generated artifacts can be opened through an SSH tunnel.

## Agentic Concepts Demonstrated

- Job intake: the job analyzer scores inherent difficulty before looking at conditions.
- Multi-source context pull: job, machine, and shop-floor context lanes run concurrently.
- Real-floor assessment: machine readiness uses actual similar-job FPY, calibration age, and open work orders.
- Alternative search: the context reader checks whether a better machine/operator pairing is available inside four hours.
- Risk synthesis: the forecaster converts conditions into first-pass yield probability and confidence.
- Decision economics: the recommendation compares schedule cost of waiting against expected rework cost of running now.
- Conditional action: the answer can be wait, run now, or run now with an added inspection gate.

## Execution Flow

```text
OpenClaw dashboard
      |
      v
main claw
      |
      v
pre-flight-chat
      |
      v
job analyzer     machine assessor     context reader
       \               |                  /
        \              |                 /
         v             v                v
                 forecaster
                      |
                      v
yield comparison, ranked drag factors, go/no-go recommendation
```

## Mock Integration

This demo uses deterministic local mocks by default:

```bash
./tools/mock-preflight-data scenario dual
./tools/mock-preflight-data scenario wait-smart
./tools/mock-preflight-data scenario run-now-smart
```

The mock returns:

- job traveler fields: geometry, material, tolerances, quantity, due date, customer quality requirements
- assigned-machine condition: calibration age, open work orders, observed similar-job FPY
- operator/shop context: shift, experience, load, temperature, humidity
- best available machine/operator condition inside four hours
- rework cost, wait cost, and inspection-gate cost

To wire real systems later, keep the same output shape and replace `tools/mock-preflight-data` with adapters for ERP/job travelers, QMS, MES, maintenance, calibration, labor scheduling, and environmental telemetry.

## Outputs

Each run writes a timestamped directory under `runs/` unless `--out` is provided.

Generated files include:

- `index.html` - browser report with side-by-side decision cards
- `job-analysis.md` - inherent difficulty scoring and job drivers
- `machine-assessment.md` - assigned-machine and best-machine comparison
- `context-reading.md` - operator, shop load, environmental, and availability context
- `forecast.md` - yield probability, confidence, ranked factors, recommendation, and cost math
- `comparison.md` - concise side-by-side decision summary
- `analysis.json` - structured machine-readable output
- `tool-responses/preflight-data.json` - raw mock data payload

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
cd pre-flight-agent
./scripts/doctor
./scripts/bootstrap
./scripts/start
```

`bootstrap` creates or updates only the `preflight-demo` OpenClaw profile. It does not modify the user's default OpenClaw profile.

## Run The Sample

Fast deterministic smoke test:

```bash
./scripts/run-sample --skip-model
```

Run one side of the demo:

```bash
./bin/pre-flight run --scenario wait-smart --skip-model
./bin/pre-flight run --scenario run-now-smart --skip-model
```

Async chat-wrapper smoke test:

```bash
./bin/pre-flight-chat --async --skip-model
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
openclaw --profile preflight-demo dashboard --no-open
```

Use the printed dashboard token to open the UI.

Ask:

```text
Before this job runs, tell me if it's going to go well.
```

The chat-facing claw should return a status link, report link, forecast link, comparison link, job-analysis link, machine-assessment link, and context-reading link.

## Remote UI From A Laptop

If the demo runs on a Spark or another remote device, tunnel both the OpenClaw gateway and report server:

```bash
ssh -L 18898:127.0.0.1:18898 -L 19011:127.0.0.1:19010 <user>@<device>
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

- The job, machine, and context data is synthetic and deterministic by design.
- The cost math is demo-grade expected-value reasoning, not a full production scheduler or probabilistic process model.
- The demo does not write to MES, QMS, calibration, or scheduling systems.
- A real integration should add approval gates before changing inspection plans, work assignments, or machine routing.