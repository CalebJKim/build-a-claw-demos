# Surprise Trip Planner

OpenClaw demo pack for turning a one-sentence relationship brief into three decision-ready weekend trip packages.

Audience: people who have relationships, people who feel guilty about not planning things, and gift-givers.

Ask: "Plan a surprise weekend trip for my partner. She loves hiking, hates crowds, and we have $1,200."

Workflow shape: constrained search -> parallel research -> merge -> decision-ready package.

## What It Shows

The demo takes a short trip brief and produces:

- three complete trip packages
- logistics and budget breakdowns
- hiking trail recommendations with crowd-avoidance tactics
- direct booking/research links
- a "why she'll love this" rationale for each option
- ready-to-send reveal messages

The intended wow moment is the reveal message. It should feel specific enough that the user could send it without rewriting the whole thing.

## Architecture

This is a host-native OpenClaw demo pack. It does not ship its own OpenClaw container. The target device provides OpenClaw, Ollama, and the local model. This directory provides an isolated OpenClaw profile, agent instructions, a seeded travel-search tool, and reset/start scripts.

The primary configuration contract is `demo.config.json`. Bootstrap, start, reset, and runner commands read from that manifest so the demo can be moved to another Spark or OpenClaw device without hardcoded paths.

Default profile: `trip-demo`

Default model: `ollama/qwen3.6:35b-a3b`

Default gateway port: `18892`

Default report server port on the device: `18996`

Default local tunnel port: `18997`

The demo has five claws:

- `main`: chat-facing operator. Routes UI requests to the packaged workflow.
- `destinations`: searches and scores destinations against budget, season, transport, and crowd constraints.
- `trails`: researches hikes, difficulty, timing, and crowd-avoidance tactics.
- `logistics`: builds transport, lodging, food, activity, contingency, and booking-link comparisons.
- `reveal`: writes the personal message the user could send to their partner.

The packaged runner in `src/run.js` is the repeatable tool that OpenClaw calls. It keeps the live demo deterministic, fast to reset, and portable. The local model can polish reveal messages and summary text during a full run, while deterministic fallbacks keep smoke tests reliable.

## What Is Included

- `demo.config.json` - demo-pack manifest: profile, ports, model, agents, required tools, generated paths, and standard commands.
- `agents/*/AGENTS.md` and `agents/*/SOUL.md` - registered OpenClaw agent workspaces and specialist instructions.
- `bin/surprise-trip` - dependency-free Node runner entrypoint.
- `bin/surprise-trip-chat` - wrapper for OpenClaw dashboard/chat usage.
- `bin/surprise-trip-job` - detached async background job runner used by chat.
- `tools/mock-travel-search` - local seeded travel-search tool.
- `data/travel-corpus.json` - demo travel corpus with destinations, hikes, costs, risks, and booking links.
- `scripts/doctor`, `scripts/bootstrap`, `scripts/start`, `scripts/run-sample`, `scripts/reset`, `scripts/uninstall` - standard repo demo-pack command surface.
- `src/run.js` - orchestrator: brief parsing, constrained search, parallel specialist analysis, merge, reveal copy, and report rendering.

Generated files are intentionally ignored by git:

- `runs/`
- `input/`
- `workspaces/`
- `.generated/`
- `.archive/`
- `openclaw/agents/`

Do not commit real user travel preferences, generated reports, OpenClaw state, tokens, or uploaded files.

## OpenClaw Features Used

- Isolated OpenClaw profile: `trip-demo`.
- Registered claws/agents with separate workspaces and prompts.
- Local model provider configuration for Ollama.
- Dashboard/chat entrypoint through the `main` claw.
- Tool invocation through local wrappers, especially `surprise-trip-chat` and `mock-travel-search`.
- Async background execution so the chat can return a status URL quickly.
- Local report hosting so generated artifacts can be opened from a laptop through an SSH tunnel.

## Agentic Concepts Demonstrated

- Constrained search: budget, origin, hiking preference, crowd aversion, and weekend timing shape the options.
- Parallel specialist research: destination scoring, trail research, and logistics comparison run as separate analysis lanes.
- Merge and rank: the runner merges specialist outputs into three complete packages.
- Tradeoff transparency: each option includes budget margin, risks, and crowd tactics.
- Personalization: the reveal claw writes a warm message grounded in the partner's stated preferences.
- Structured output: the same analysis is rendered as Markdown, JSON, booking links, reveal messages, and an HTML report.

## Execution Flow

```text
OpenClaw dashboard
      |
      v
main claw
      |
      v
surprise-trip-chat
      |
      v
mock-travel-search
      |
      v
destinations     trails     logistics
      \             |          /
       \            |         /
        v           v        v
              merge + rank
                   |
                   v
             reveal messages
                   |
                   v
trip packages, booking links, HTML report
```

## Tools Used

- OpenClaw CLI, gateway, dashboard, profiles, and registered agents.
- Ollama local model API at `http://127.0.0.1:11434`.
- `tools/mock-travel-search` for deterministic destination/trail/logistics data.
- Node.js for the packaged workflow runner.
- Python `http.server` for report hosting.
- No npm install is required for the runner.

## Outputs

Each run writes a timestamped directory under `runs/` unless `--out` is provided.

Generated files include:

- `index.html` - browser report
- `trip-packages.md` - three trip packages with rationale, logistics, costs, hikes, reveal messages, and links
- `reveal-messages.md` - ready-to-send message per package
- `booking-links.md` - transport, lodging, park, and trail links
- `analysis.json` - structured machine-readable output
- `brief.txt` - copied input brief
- `mock-travel-search.json` - seeded tool response

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
cd surprise-trip-planner-agent
./scripts/doctor
./scripts/bootstrap
./scripts/start
```

`bootstrap` creates or updates only the `trip-demo` OpenClaw profile. It does not modify the user's default OpenClaw profile.

## Run The Sample

Fast deterministic smoke test:

```bash
./scripts/run-sample --skip-model
```

Async chat-wrapper smoke test:

```bash
./bin/surprise-trip-chat --async --skip-model
```

Full local-model run:

```bash
./scripts/run-sample
```

The command prints the generated report path. Open `index.html` from the run directory, or use the report server started by `./scripts/start`.

## Run With A Custom Brief

```bash
./bin/surprise-trip run \
  --brief "Plan a surprise weekend trip for my partner. She loves hiking, hates crowds, and we have $1,200." \
  --origin "San Francisco, CA" \
  --budget 1200 \
  --partner-name "Maya" \
  --traveler-name "Caleb" \
  --dates "a spring weekend"
```

## Run Through OpenClaw UI

Start services:

```bash
./scripts/start
openclaw --profile trip-demo dashboard --no-open
```

Use the printed dashboard token to open the UI.

Ask:

```text
Plan a surprise weekend trip for my partner. She loves hiking, hates crowds, and we have $1,200.
```

The chat-facing claw should return a status link. The async wrapper is used because travel planning and artifact generation may exceed a chat tool timeout.

## Remote UI From A Laptop

If the demo runs on a Spark or another remote device, tunnel both the OpenClaw gateway and report server:

```bash
ssh -L 18892:127.0.0.1:18892 -L 18997:127.0.0.1:18996 <user>@<device>
```

Then open the dashboard and reports through localhost on the laptop.

## Reset Between Runs

For a fresh audience or a fresh prompt:

```bash
./scripts/reset
./scripts/start
```

`reset` archives old generated runs and clears `runs/`, `input/`, and `.generated/`. It keeps the `trip-demo` OpenClaw profile installed so the demo can start quickly again.

## Uninstall

To remove this demo's generated local state:

```bash
./scripts/uninstall
```

## Known Limits

- Travel data is seeded for reliability; it is not a live fare or hotel inventory system.
- Booking links are direct research/booking links, not held reservations.
- Cost estimates are demo estimates and should be verified before purchase.
- The demo currently assumes a San Francisco origin best; other origins can run, but the seeded corpus is Bay Area oriented.

## Demo Talk Track

Read the reveal message out loud. That is the moment.

Recommended live flow:

1. Ask with the one-sentence brief.
2. Open the status page.
3. Show the three ranked packages.
4. Show the cost breakdown so it feels real.
5. Read the reveal message for the top option.
6. Finish with the booking links.

The point is not just finding a pretty destination. The point is showing that the plan understands the relationship and removes the emotional labor of planning.
