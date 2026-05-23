# Side Project Launcher


> **Try it:** "I want to sell handmade soaps online. I have no idea where to start."

OpenClaw demo pack for turning a one-line business idea into a market-backed brand, product copy, live landing page, and week-one launch checklist.

Audience: makers, entrepreneurs, and people with ideas stuck in their heads.

Ask: "I want to sell handmade soaps online. I have no idea where to start."

Workflow shape: idea -> market research -> brand -> build -> launch-ready.

## What It Shows

The demo takes a rough business idea and produces:

- a pragmatic market snapshot with competitors, price points, buyer language, and gaps
- three brand name options with rationale, a selected winner, and tagline
- homepage copy, product descriptions, benefit bullets, and About copy
- a working landing page with product layout and email capture
- a browser report linking the launch artifacts
- a week-one checklist of what to do next

The intended wow moment is the live URL. The user walks in with a loose idea and walks out with a landing page they can open on a phone.

## Architecture

This is a host-native OpenClaw demo pack. It does not ship OpenClaw in a container. The target device provides OpenClaw, Ollama, and the local model; this directory provides a sterile OpenClaw profile, agent instructions, deterministic tool data, and scripts for bootstrap/start/reset.

The primary configuration contract is `demo.config.json`. Scripts read profile names, ports, model IDs, agent definitions, generated paths, and sample prompts from the manifest so the demo can be moved to another Spark or OpenClaw device without path edits.

Default profile: `launcher-demo`

Default model: `ollama/qwen3.6:35b-a3b`

Default gateway port: `18893`

Default report server port on the device: `18998`

Default local tunnel port: `18999`

The demo has five claws:

- `main`: chat-facing operator. Routes UI requests to the packaged workflow.
- `market`: researches competitors, price points, marketplace/social signals, buyer language, and gaps.
- `brand`: generates three brand options, picks the strongest, and writes a tagline.
- `copy`: writes homepage copy, product descriptions, benefits, About copy, and email capture text.
- `builder`: assembles the launch package into a live landing page, report, and checklist.

The packaged runner in `src/run.js` is the repeatable tool that OpenClaw calls. It makes the live demo deterministic, easy to reset, and portable. The local model can polish copy during a full run, while deterministic fallbacks keep smoke tests reliable.

## What Is Included

- `demo.config.json` - demo-pack manifest: profile, ports, model, agents, required tools, generated paths, and standard commands.
- `agents/*/AGENTS.md` and `agents/*/SOUL.md` - registered OpenClaw agent workspaces and specialist instructions.
- `bin/side-project-launcher` - dependency-free Node runner entrypoint.
- `bin/side-project-launcher-chat` - wrapper for OpenClaw dashboard/chat usage.
- `bin/side-project-launcher-job` - detached async background job runner used by chat.
- `tools/mock-market-search` - local seeded market-search tool.
- `data/market-corpus.json` - demo corpus with Etsy, Instagram, Shopify, competitor, pricing, product, and channel signals.
- `scripts/doctor`, `scripts/bootstrap`, `scripts/start`, `scripts/run-sample`, `scripts/reset`, `scripts/uninstall` - standard repo demo-pack command surface.
- `src/run.js` - orchestrator: idea parsing, market research, brand generation, copy generation, landing page build, and report rendering.

Generated files are intentionally ignored by git:

- `runs/`
- `input/`
- `workspaces/`
- `.generated/`
- `.archive/`
- `openclaw/agents/`

Do not commit real user ideas, generated reports, OpenClaw state, tokens, email captures, or uploaded files.

## OpenClaw Features Used

- Isolated OpenClaw profile: `launcher-demo`.
- Registered claws/agents with separate workspaces and prompts.
- Local model provider configuration for Ollama.
- Dashboard/chat entrypoint through the `main` claw.
- Tool invocation through local wrappers, especially `side-project-launcher-chat` and `mock-market-search`.
- Async background execution so the chat can return a status URL quickly.
- Local report hosting so generated landing pages can be opened from a laptop through an SSH tunnel.

## Agentic Concepts Demonstrated

- Market research tool call: the workflow calls `tools/mock-market-search` as a deterministic stand-in for marketplace and social research.
- Parallel specialist work: market research, brand generation, and copy seed generation run in parallel before the merge step.
- Merge and build: the builder combines market, brand, and copy outputs into a launch-ready package.
- Decision support: the report explains the chosen brand, the market gap, and the next actions instead of only generating pretty copy.
- Artifact generation: the same analysis becomes Markdown, JSON, an HTML report, and a standalone landing page.
- Local-model polishing: Ollama can rewrite the final copy while the fallback keeps the demo functional if the model is skipped for smoke tests.

## Execution Flow

```text
OpenClaw dashboard
      |
      v
main claw
      |
      v
side-project-launcher-chat
      |
      v
mock-market-search
      |
      v
market        brand        copy
  \             |           /
   \            |          /
    v           v         v
          merge + build
               |
               v
landing page, launch report, week-one checklist
```

## Tools Used

- OpenClaw CLI, gateway, dashboard, profiles, and registered agents.
- Ollama local model API at `http://127.0.0.1:11434`.
- `tools/mock-market-search` for deterministic marketplace and social-channel signals.
- Node.js for the packaged workflow runner.
- Python `http.server` for report and landing-page hosting.
- No npm install is required for the runner.

## Outputs

Each run writes a timestamped directory under `runs/` unless `--out` is provided.

Generated files include:

- `index.html` - browser report
- `landing-page/index.html` - live landing page
- `landing-page/assets/soap-bars.svg` - generated product visual for the landing page
- `market-research.md` - competitor, pricing, buyer-language, and gap notes
- `brand.md` - brand options, winner, tagline, and visual direction
- `product-copy.md` - homepage copy, products, benefits, and About copy
- `week-one-checklist.md` - concrete first-week tasks
- `analysis.json` - structured machine-readable output
- `idea.txt` - copied input idea
- `mock-market-search.json` - seeded tool response

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
cd side-project-launcher-agent
./scripts/doctor
./scripts/bootstrap
./scripts/start
```

`bootstrap` creates or updates only the `launcher-demo` OpenClaw profile. It does not modify the user's default OpenClaw profile.

## Run The Sample

Fast deterministic smoke test:

```bash
./scripts/run-sample --skip-model
```

Async chat-wrapper smoke test:

```bash
./bin/side-project-launcher-chat --async --skip-model
```

Full local-model run:

```bash
./scripts/run-sample
```

The command prints the generated report and landing-page paths. Open `landing-page/index.html` from the run directory, or use the report server started by `./scripts/start`.

## Run With A Custom Idea

```bash
./bin/side-project-launcher run \
  --idea "I want to sell handmade soaps online. I have no idea where to start." \
  --founder-name "Avery" \
  --audience "people who want gentle, good-looking soap that feels giftable but not precious" \
  --location "United States"
```

## Run Through OpenClaw UI

Start services:

```bash
./scripts/start
openclaw --profile launcher-demo dashboard --no-open
```

Use the printed dashboard token to open the UI.

Ask:

```text
I want to sell handmade soaps online. I have no idea where to start.
```

The chat-facing claw should return a status link and a landing-page link. The async wrapper is used because artifact generation may exceed a chat tool timeout.

## Remote UI From A Laptop

If the demo runs on a Spark or another remote device, tunnel both the OpenClaw gateway and report server:

```bash
ssh -L 18893:127.0.0.1:18893 -L 18999:127.0.0.1:18998 <user>@<device>
```

Then open the dashboard and generated landing pages through localhost on the laptop.

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

1. Ask for a one-line idea.
2. Open the generated status URL.
3. When complete, open the landing-page URL.
4. Show the brand name, three products, email capture, and week-one checklist.
5. Open the same URL on a phone or through the laptop tunnel to make the output feel real.

## Known Limits

- The market research uses a seeded local corpus, not live Etsy, Instagram, or Shopify scraping. That keeps the live demo fast and repeatable.
- The generated email capture stores addresses in browser `localStorage`; it is a demo capture, not a production backend.
- The landing page is static HTML. For public sharing, upload `landing-page/` to a static host or put it behind the event network.
- The default corpus is tuned for handmade soaps. Other ideas will still produce a package, but the best live demo is the seeded soap prompt.