# The Scrap Genome

> **Try it:** "We're scrapping too many parts on this geometry. Why."

OpenClaw demo pack for turning noisy scrap history into a live process-risk warning and specific manufacturing recommendations.

Audience: quality engineers, process engineers, and plant managers who have stared at scrap reports without getting an actionable answer.

Ask: "We're scrapping too many parts on this geometry. Why."

Workflow shape: historical data ingest -> multi-variable correlation -> causal fingerprinting -> actionable insight.

## What It Shows

The demo investigates the `impeller-housing-G7` part family over the last 90 days and produces:

- a scrap genome visualization of the interaction fingerprints driving failures
- plain-English findings with exact lift, sample size, scrap rate, and event counts
- three process changes with projected impact
- flagged material lots that are overrepresented in high-risk windows
- a live current-conditions warning: "You are in an elevated-risk window right now"

The intended wow moment is the last line. The audience sees that the claw is not only describing history; it learned the failure pattern from the past and applied it to today's shop-floor state.

## Architecture

This is a host-native OpenClaw demo pack. It does not ship OpenClaw in a container. The target device provides OpenClaw, Ollama, and the local model; this directory provides a sterile OpenClaw profile, specialist agent instructions, seeded quality data, a mock quality-data tool, and repeatable scripts.

The primary configuration contract is `demo.config.json`. Scripts read profile names, ports, model IDs, agent definitions, generated paths, and sample prompts from the manifest so the demo can be moved to another Spark or OpenClaw device without path edits.

Default profile: `scrap-demo`

Default model: `ollama/qwen3.6:35b-a3b`

Default gateway port: `18897`

Default report server port on the device: `19008`

Default local tunnel port: `19009`

The demo has five claws:

- `main`: chat-facing operator. Routes scrap-investigation prompts into the packaged workflow.
- `collector`: pulls every scrap and good-part event for the part family, including machine, operator, shift, tool age, material lot, humidity, spindle load, and maintenance context.
- `correlator`: compares scrap events against good runs and ranks multi-variable interaction fingerprints.
- `narrator`: translates the statistical output into blunt, specific, non-statistician language.
- `recommender`: turns the findings into concrete process changes with projected reduction.

The packaged runner in `src/run.js` is the repeatable tool OpenClaw calls. It collects mock quality data, correlates single variables and interaction combinations, evaluates today's conditions against the learned fingerprints, optionally polishes the lead finding with the local Ollama model, and renders markdown plus an HTML report.

## What Is Included

- `demo.config.json` - demo-pack manifest: profile, ports, model, agents, required tools, generated paths, and standard commands.
- `agents/*/AGENTS.md` and `agents/*/SOUL.md` - registered OpenClaw agent workspaces and specialist instructions.
- `bin/scrap-genome` - dependency-free Node runner entrypoint.
- `bin/scrap-genome-chat` - wrapper for OpenClaw dashboard/chat usage.
- `bin/scrap-genome-job` - detached async background job runner used by chat.
- `tools/mock-quality-data` - local QMS/MES/environment-data mock.
- `data/scrap-seed.json` - seeded part family, geometry, shop-floor conditions, material lots, and process context.
- `scripts/doctor`, `scripts/bootstrap`, `scripts/start`, `scripts/run-sample`, `scripts/reset`, `scripts/uninstall` - standard repo demo-pack command surface.

Generated files are intentionally ignored by git:

- `runs/`
- `input/`
- `workspaces/`
- `.generated/`
- `.archive/`
- `openclaw/agents/`

Do not commit generated reports, real QMS/MES exports, OpenClaw state, tokens, or real customer/plant data.

## OpenClaw Features Used

- Isolated OpenClaw profile: `scrap-demo`.
- Registered claws/agents with separate workspaces and prompts.
- Local model provider configuration for Ollama.
- Dashboard/chat entrypoint through the `main` claw.
- Tool invocation through local wrappers and the `mock-quality-data` tool.
- Async background execution so the chat can return a status URL quickly.
- Local report hosting so generated artifacts can be opened through an SSH tunnel.

## Agentic Concepts Demonstrated

- Historical data ingest: the collector gathers good and scrap events, not just failed parts.
- Context-rich event records: each run includes machine, operator, shift, tool age, material lot, humidity, spindle load, and maintenance context.
- Multi-variable correlation: the correlator searches interactions such as tool age plus humidity plus spindle load.
- Causal fingerprinting: the output ranks combinations by lift, scrap count, and sample size instead of showing generic dashboards.
- Plain-English synthesis: the narrator keeps the exact numbers but removes statistical jargon.
- Live risk application: today's conditions are scored against the learned fingerprints.
- Actionable recommendation: the recommender produces process-control changes, not vague advice.

## Execution Flow

```text
OpenClaw dashboard
      |
      v
main claw
      |
      v
scrap-genome-chat
      |
      v
collector
      |
      v
correlator
      |
      v
narrator       recommender
      \          /
       \        /
        v      v
scrap genome, findings, process changes, live risk warning
```

## Mock Integration

This demo uses a deterministic local quality-data mock by default:

```bash
./tools/mock-quality-data collect impeller-housing-G7 90
```

The mock returns:

- scrap and good-part events across 90 days
- machine, shift, operator, tool age, material lot, humidity, temperature, spindle load, and maintenance context
- seeded material lots `AL-8821` and `AL-8827`
- current shop-floor conditions that intentionally match the top risk fingerprint

To wire real systems later, keep the same output shape and replace `tools/mock-quality-data` with an adapter for QMS, MES, environmental telemetry, tool-life tracking, and maintenance history.

## Outputs

Each run writes a timestamped directory under `runs/` unless `--out` is provided.

Generated files include:

- `index.html` - browser report with current-conditions risk widget
- `data-summary.md` - dataset size, scrap rate, and failure modes
- `scrap-genome.md` - ranked interaction fingerprints and single-variable signals
- `plain-english-findings.md` - 30-second non-statistician explanation
- `recommendations.md` - three concrete process changes with projected impact
- `current-conditions.md` - live warning against today's machine, shift, tool age, lot, humidity, and spindle load
- `analysis.json` - structured machine-readable output
- `tool-responses/quality-data.json` - raw mock data payload

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
cd scrap-genome-agent
./scripts/doctor
./scripts/bootstrap
./scripts/start
```

`bootstrap` creates or updates only the `scrap-demo` OpenClaw profile. It does not modify the user's default OpenClaw profile.

## Run The Sample

Fast deterministic smoke test:

```bash
./scripts/run-sample --skip-model
```

Async chat-wrapper smoke test:

```bash
./bin/scrap-genome-chat --async --skip-model
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
openclaw --profile scrap-demo dashboard --no-open
```

Use the printed dashboard token to open the UI.

Ask:

```text
We're scrapping too many parts on this geometry. Why.
```

The chat-facing claw should return a status link, report link, scrap genome link, findings link, recommendations link, and current-conditions link.

## Remote UI From A Laptop

If the demo runs on a Spark or another remote device, tunnel both the OpenClaw gateway and report server:

```bash
ssh -L 18897:127.0.0.1:18897 -L 19009:127.0.0.1:19008 <user>@<device>
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

- The quality data is synthetic and deterministic by design. It is seeded to produce a credible 3.4x interaction fingerprint for the live demo.
- The demo identifies statistical fingerprints, not formal causal proof. The recommendation language should stay operational: change interval, add inspection, flag lots.
- The default action is analysis only. It does not change a real MES, QMS, tool-life table, or inspection plan.
- A real integration should add approval gates before writing process-control changes back into production systems.