# One Ask, Twenty Steps Done

> **Try it:** "Put together a reading list on personal finance for a beginner."

One request triggers a full workflow: search, filter, write, format, verify, and publish. The user can move on while the agent handles the intermediate work.

Demo request:

```text
Put together a reading list on personal finance for a beginner.
```

This project is designed for a NemoClaw-managed OpenShell sandbox with an OpenClaw agent, and it also runs locally with Node.js.

## What Is Included

- `scripts/demo-runner.mjs` - dependency-free deterministic workflow runner.
- `data/search_results.json` - candidate results, including trusted sources and intentionally weak examples to filter.
- `data/workflow_steps.json` - the twenty-step trace shown in the generated document.
- `agent/one-ask-workflow-agent.md` - OpenClaw agent design and operating rules.
- `openclaw-workspace/` - OpenClaw workspace instructions.
- `policies/research-publishing.yaml` - example NemoClaw/OpenShell policy preset.
- `scripts/bootstrap-openclaw-agent.sh` - register the OpenClaw agent inside the sandbox.
- `scripts/upload-to-openshell.sh` - upload the demo into an OpenShell sandbox.

## Run Locally

```bash
npm run demo
```

or:

```bash
node scripts/demo-runner.mjs "Put together a reading list on personal finance for a beginner."
```

The runner writes:

- `output/beginner-personal-finance-reading-list.md`
- `output/beginner-personal-finance-reading-list.html`

To inspect the structured run:

```bash
npm run demo:json
```

## Run Inside NemoClaw and OpenShell

1. Confirm the NemoClaw sandbox exists.

```bash
nemoclaw list
```

2. If needed, create or reconfigure a sandbox.

```bash
nemoclaw onboard
```

3. Upload this demo into the sandbox.

```bash
./scripts/upload-to-openshell.sh my-assistant
```

4. Connect to the sandbox.

```bash
nemoclaw my-assistant connect
```

5. Inside the sandbox, register the OpenClaw agent and run the demo.

```bash
cd /sandbox/one-ask-workflow
./scripts/bootstrap-openclaw-agent.sh
node scripts/demo-runner.mjs
```

6. Ask OpenClaw to use the registered agent.

```bash
openclaw agent --agent one-ask-workflow --message "Run the one-ask reading-list workflow for: Put together a reading list on personal finance for a beginner."
```

## Demo Narrative

The agent:

1. Captures the ask and intended audience.
2. Expands the query into research topics.
3. Searches a repeatable candidate corpus.
4. Scores each result for authority, beginner fit, clarity, practicality, relevance, freshness, commercial pressure, and risk flags.
5. Filters out weak or speculative results.
6. Selects a balanced reading list by topic.
7. Writes short descriptions for each pick.
8. Formats Markdown and renders HTML.
9. Verifies that artifacts contain the expected sections.
10. Publishes clean files in `output/`.

## Apply The Example Policy

NemoClaw uses deny-by-default network policy through OpenShell. The policy preset in `policies/research-publishing.yaml` allows representative read-only access to official education sources and sandbox-local publishing.

```bash
cp policies/research-publishing.yaml ~/.nemoclaw/source/nemoclaw-blueprint/policies/presets/one-ask-research.yaml
nemoclaw my-assistant policy-add
```

## Guardrails

This demo produces educational content only. It does not recommend specific securities, accounts, lenders, insurers, tax strategies, or personalized financial plans.

## OpenClaw Demo Pack

This directory now follows the repo demo-pack format. It has a manifest, isolated OpenClaw profile, standard scripts, and a chat wrapper that publishes the generated HTML under `runs/`.

- Profile: `one-ask-demo`
- Gateway: `18903`
- Report server: `19020`
- Local model: `ollama/qwen3.6:35b-a3b`
- Chat-facing command: `bin/one-ask-twenty-steps-chat --ask "<ask>" --async`

Standard run flow:

```bash
./scripts/doctor
./scripts/bootstrap
./scripts/start
./scripts/run-sample
```

To use the OpenClaw UI:

```bash
./scripts/start
openclaw --profile one-ask-demo dashboard
```

Ask for a research/publishing deliverable. The main agent invokes the deterministic twenty-step runner and returns the report URL.

Reset between demos:

```bash
./scripts/reset
```

Generated state lives under `runs/`, `input/`, `workspaces/`, `.generated/`, `.archive/`, and `openclaw/agents/`. The existing `output/` folder remains the legacy local-demo target; the OpenClaw wrapper writes fresh stage runs to `runs/`.