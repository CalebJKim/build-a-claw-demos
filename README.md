# Build A Claw Demos

This repo contains portable OpenClaw demos. Each demo should be packaged so it can be cloned onto a device with OpenClaw installed, bootstrapped into an isolated profile, run live, reset for a fresh audience, and removed without disturbing other demos.

The goal is repeatable demo shipping: a builder should be able to add a new demo directory, follow the same structure, and hand it to someone else with enough instructions to run it on a new device.

## Current Demos

- `intro-basics/` - introductory OpenClaw/Spark notes.
- `semiconductor-manufacturing-agent/` - semiconductor manufacturing operations demo with synthetic fab data and OpenClaw workspace files.
- `resume-callback-agent/` - resume callback demo with PDF upload, parallel specialist claws, local Ollama execution, report generation, and upgraded resume output.

## Packaging Model

Use host-native OpenClaw demo packs by default.

That means:

- OpenClaw is installed on the target device normally.
- Ollama or another local model runtime is installed on the target device normally.
- Each demo owns a unique OpenClaw profile, for example `resume-demo`.
- Each demo owns its own gateway port, workspaces, agent state, input files, generated runs, and reset behavior.
- Demo-specific orchestration lives in scripts/tools inside the demo directory.
- Docker is optional and should only be used for supporting services such as mock APIs, databases, queues, or webhooks.

Do not make demos depend on the default `~/.openclaw` profile. A demo should be sterile: it should install into `~/.openclaw-<profile>` and keep generated state inside its own directory.

## Why Profiles

OpenClaw profiles are the isolation boundary. A profile gives each demo its own:

- `openclaw.json`
- gateway settings
- model provider settings
- registered agents
- workspace defaults
- media/upload state
- service lifecycle

Profiles make demos swappable. You can stop or reset one profile and bootstrap another without rewriting the user's normal OpenClaw setup.

The main things that can still interfere across demos are shared host resources:

- duplicate gateway ports
- too many local model jobs competing for GPU/RAM
- stale gateway services still running
- globally upgraded OpenClaw versions
- scripts writing outside their demo directory

Every demo should include checks for those risks.

## Required Demo Shape

New demos should use this structure unless there is a clear reason not to:

```text
demo-name/
  README.md
  demo.config.json
  package.json
  .env.example
  .gitignore
  agents/
    main/
      AGENTS.md
      SOUL.md
      TOOLS.md
    specialist/
      AGENTS.md
      SOUL.md
  openclaw/
    patch.template.json
  scripts/
    doctor
    bootstrap
    start
    run-sample
    reset
    uninstall
  src/
  tools/
  samples/
```

Existing demos may not match this exactly yet, but new demos should converge on it.

## What Each Demo Needs

Each demo must include:

- A unique demo name and OpenClaw profile.
- A clear target audience and live-demo ask.
- A documented workflow shape, such as fan-out, tool call, planner/executor, or report generator.
- A list of agents/claws and what each one owns.
- A model requirement, including local model name if using Ollama.
- Required system tools, such as Node, Python, `pdftotext`, Chromium, or `curl`.
- A bootstrap script that is safe to rerun.
- A doctor script that checks dependencies before a live demo.
- A start script or dashboard instructions.
- A sample input and sample command.
- A reset script for a fresh run.
- An uninstall or cleanup path.
- A `.gitignore` that prevents generated state, uploaded files, tokens, and real user data from being committed.

Each demo README must explain:

- what the demo shows
- how to set it up on a new device
- how to run the sample
- how to run the live version
- how to open the UI remotely, if needed
- how to reset it before the next run
- what files are safe or unsafe to commit
- known limitations and expected failure modes

## Manifest

Each demo should include a `demo.config.json` manifest. This lets repo-level tools validate, bootstrap, and reset demos consistently.

Recommended fields:

```json
{
  "name": "resume-callback-agent",
  "profile": "resume-demo",
  "openclawMinVersion": "2026.5.12",
  "nodeMinVersion": "22.16.0",
  "model": {
    "provider": "ollama",
    "id": "qwen3.6:35b-a3b",
    "openclawId": "ollama/qwen3.6:35b-a3b",
    "baseUrl": "http://127.0.0.1:11434"
  },
  "ports": {
    "gateway": 18889,
    "report": 18990,
    "localTunnel": 18991
  },
  "agents": [
    {
      "id": "main",
      "workspace": "workspaces/main",
      "agentDir": "openclaw/agents/main/agent"
    }
  ],
  "requiredCommands": [
    "openclaw",
    "node",
    "ollama",
    "curl"
  ],
  "generatedPaths": [
    "runs",
    "input",
    "workspaces",
    ".generated",
    ".archive",
    "openclaw/agents"
  ],
  "commands": {
    "doctor": "./scripts/doctor",
    "bootstrap": "./scripts/bootstrap",
    "start": "./scripts/start",
    "sample": "./scripts/run-sample",
    "reset": "./scripts/reset",
    "uninstall": "./scripts/uninstall"
  }
}
```

The manifest is the contract. Scripts may do the actual work, but they should read from the manifest instead of duplicating profile names, ports, and model IDs.

## Standard Commands

Every demo should eventually support these commands:

```bash
./scripts/doctor
./scripts/bootstrap
./scripts/start
./scripts/run-sample
./scripts/reset
./scripts/uninstall
```

Expected behavior:

- `doctor` checks dependencies, model availability, OpenClaw version, ports, and obvious path problems.
- `bootstrap` creates or updates the isolated profile, config patch, workspaces, agents, and gateway service.
- `start` starts the gateway/dashboard/report services needed for the live demo.
- `run-sample` runs a deterministic sample or smoke test.
- `reset` clears generated demo state while keeping the installed profile intact.
- `uninstall` removes the demo profile/service/state when the demo should be fully removed.

## OpenClaw Setup Pattern

Bootstrap scripts should prefer supported OpenClaw CLI surfaces:

```bash
openclaw --profile "$PROFILE" config patch --file "$PATCH"
openclaw --profile "$PROFILE" agents add "$AGENT_ID" \
  --workspace "$WORKSPACE_DIR" \
  --agent-dir "$AGENT_DIR" \
  --model "$MODEL" \
  --non-interactive \
  --json
openclaw --profile "$PROFILE" gateway install --port "$PORT" --runtime node --force --json
openclaw --profile "$PROFILE" gateway restart --json
```

Avoid hand-editing `~/.openclaw*` files directly unless there is no supported CLI path.

## Agent And Tool Boundaries

Keep each agent's role explicit:

- `main` should be the chat-facing operator.
- Specialist agents should have narrow responsibilities.
- Long-running workflows should use a local orchestrator script instead of relying on a single UI chat turn.
- Tools should write outputs under the demo directory.
- Real user data should stay in ignored paths such as `input/` and `runs/`.

For demos with multiple claws, it is fine for an orchestrator to call specialist prompts/tools directly. That is often more reliable for live demos than waiting for separate agent-to-agent chat turns, especially with local models and large outputs.

## Generated State

Never commit:

- real uploaded files
- generated reports
- local OpenClaw profile state
- tokens
- `.env`
- model caches
- temporary workspaces

Use `.gitignore` entries like:

```gitignore
.env
.generated/
.archive/
runs/
input/
workspaces/
openclaw/agents/
node_modules/
*.log
```

If a demo needs example output in git, put it under `examples/` or `docs/` and clearly label it as checked-in sample output.

## Remote UI Access

For devices such as Spark, demos should document the required tunnels.

Example:

```bash
ssh -L 18889:127.0.0.1:18889 \
    -L 18991:127.0.0.1:18990 \
    user@device
```

Then launch the dashboard on the device:

```bash
openclaw --profile <profile> dashboard --no-open
```

The README should tell users which local URLs to open and where to get the token.

## Shipping Checklist

Before pushing a demo:

- `git status` shows only intended files.
- `scripts/doctor` passes on the target device.
- `scripts/bootstrap` is safe to rerun.
- `scripts/run-sample` works from a clean checkout.
- `scripts/reset` creates a fresh demo state.
- Gateway/profile names do not conflict with other demos.
- Ports are documented and configurable.
- Real resumes, uploads, reports, tokens, and local state are not committed.
- The README explains the live flow and fallback manual commands.
- The demo has at least one tested target-device run.

## Recommended Repo Tooling

The repo should eventually include a small `democtl` wrapper:

```bash
./democtl list
./democtl doctor resume-callback-agent
./democtl bootstrap resume-callback-agent
./democtl start resume-callback-agent
./democtl reset resume-callback-agent
./democtl uninstall resume-callback-agent
```

`democtl` should read each demo's `demo.config.json`, validate the manifest, and delegate to the demo's scripts. That keeps individual demos flexible while making the repo feel consistent.

## Practical Rule

A good demo pack hides operational mess without hiding the architecture. The audience should see a simple live flow; the builder should see clear profiles, agents, tools, scripts, and reset paths.
