# Self-Fixing Game

OpenClaw demo pack for turning a loose "build a multiplayer trivia game" request into a real phone-playable game, a self-test/fix loop, a bug report, and a live URL.

Audience: developers, tech-curious people, and anyone who has tried to vibe-code and given up.

Ask: "Build me a multiplayer trivia game my friends can play from their phones right now."

Workflow shape: spec -> build -> self-test -> find bugs -> fix -> ship.

## What It Shows

The demo takes a loose game request and produces:

- a concrete game spec
- a complete no-dependency multiplayer trivia app
- a generated server, mobile client, styles, and game logic
- an autonomous bug report showing what broke in the first build
- a fixed build with verification results
- a live game URL that phones can join

The intended wow moment is the bug report. The audience sees the tester claw catch real bugs, the builder claw repair them, and the deployer claw start the fixed game while people are already joining from phones.

## Architecture

This is a host-native OpenClaw demo pack. It does not ship OpenClaw in a container. The target device provides OpenClaw, Ollama, Node, and the local model; this directory provides a sterile OpenClaw profile, agent instructions, generated game runner, test/fix loop, and reset/start scripts.

The primary configuration contract is `demo.config.json`. Scripts read profile names, ports, model IDs, agent definitions, generated paths, and sample prompts from the manifest so the demo can be moved to another Spark or OpenClaw device without path edits.

Default profile: `game-demo`

Default model: `ollama/qwen3.6:35b-a3b`

Default gateway port: `18894`

Default report server port on the device: `19000`

Default local report tunnel port: `19001`

Default game server port on the device: `19002`

Default local game tunnel port: `19003`

The demo has five claws:

- `main`: chat-facing operator. Routes UI requests to the packaged workflow.
- `spec`: turns the loose prompt into rules, player flow, mobile constraints, and test targets.
- `builder`: writes the generated Node server, client, CSS, and core game logic, then applies tester fixes.
- `tester`: imports the generated game logic, plays through failure cases, scans mobile layout, and smoke-tests the server.
- `deployer`: starts the fixed game server and returns the live URL plus report links.

The packaged runner in `src/run.js` is the repeatable tool that OpenClaw calls. It intentionally creates a first build with realistic defects, runs autonomous tests, rewrites the fixed build, verifies the final code, and starts the live game server.

## What Is Included

- `demo.config.json` - demo-pack manifest: profile, ports, model, agents, required tools, generated paths, and standard commands.
- `agents/*/AGENTS.md` and `agents/*/SOUL.md` - registered OpenClaw agent workspaces and specialist instructions.
- `bin/self-fixing-game` - dependency-free Node runner entrypoint.
- `bin/self-fixing-game-chat` - wrapper for OpenClaw dashboard/chat usage.
- `bin/self-fixing-game-job` - detached async background job runner used by chat.
- `scripts/doctor`, `scripts/bootstrap`, `scripts/start`, `scripts/run-sample`, `scripts/reset`, `scripts/uninstall` - standard repo demo-pack command surface.
- `src/run.js` - orchestrator: spec, generated code, self-test, fix loop, server smoke test, deploy, and report rendering.

Generated files are intentionally ignored by git:

- `runs/`
- `input/`
- `workspaces/`
- `.generated/`
- `.archive/`
- `openclaw/agents/`

Do not commit generated games, reports, OpenClaw state, tokens, real prompts, or event logs.

## OpenClaw Features Used

- Isolated OpenClaw profile: `game-demo`.
- Registered claws/agents with separate workspaces and prompts.
- Local model provider configuration for Ollama.
- Dashboard/chat entrypoint through the `main` claw.
- Tool invocation through local wrappers, especially `self-fixing-game-chat`.
- Async background execution so chat can return a status URL quickly.
- Local report hosting for the bug report and build report.
- A separate generated game server for the phone-playable multiplayer URL.

## Agentic Concepts Demonstrated

- Spec-to-code: the spec claw converts a vague request into concrete rules, architecture, and test criteria.
- Code generation: the builder claw writes a complete server/client game, not a static mockup.
- Autonomous self-test: the tester claw checks wrong-answer handling, timer expiry, mobile layout, required files, and server endpoints.
- Self-repair loop: failing tests become fix instructions, then the builder rewrites the generated game.
- Verification before ship: the fixed build is tested again before the deployer returns the URL.
- Artifact transparency: the report includes both what was built and what was broken/fixed.

## Execution Flow

```text
OpenClaw dashboard
      |
      v
main claw
      |
      v
self-fixing-game-chat
      |
      v
spec claw -> builder claw -> tester claw
                         |       |
                         |   bug report
                         v       |
                    builder fixes
                         |
                         v
                   tester verifies
                         |
                         v
                    deployer starts
                         |
                         v
          live game URL + bug report + build report
```

## Generated Game Stack

The generated game is intentionally simple and portable:

- Node built-in `http` server
- Server-Sent Events for live state updates
- Vanilla browser client
- No npm dependencies
- Shared in-memory room state
- First joined player becomes host
- Phones join from the same URL
- Timed multiple-choice trivia rounds
- Live scoreboard and event log

## Outputs

Each run writes a timestamped directory under `runs/` unless `--out` is provided.

Generated files include:

- `index.html` - browser build report
- `bug-report.md` - self-test failures, fixes, and final verification
- `test-log.md` - raw first-build, fixed-build, and server smoke-test results
- `spec.md` - game spec and questions
- `deploy.md` - live URL and tunnel notes
- `analysis.json` - structured machine-readable output
- `brief.txt` - copied input prompt
- `game/server.js` - generated multiplayer server
- `game/game-core.mjs` - generated game state/scoring/timer logic
- `game/public/index.html` - generated phone UI
- `game/public/client.js` - generated browser client
- `game/public/styles.css` - generated mobile-first styling

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
cd self-fixing-game-agent
./scripts/doctor
./scripts/bootstrap
./scripts/start
```

`bootstrap` creates or updates only the `game-demo` OpenClaw profile. It does not modify the user's default OpenClaw profile.

## Run The Sample

Fast deterministic run without model polishing:

```bash
./scripts/run-sample --skip-model
```

Build/test only, without starting the final game server:

```bash
./scripts/run-sample --skip-model --no-serve
```

Async chat-wrapper smoke test:

```bash
./bin/self-fixing-game-chat --async --skip-model
```

Full local-model run:

```bash
./scripts/run-sample
```

The command prints the generated game URL, bug report path, and build report path.

## Run With A Custom Brief

```bash
./bin/self-fixing-game run \
  --brief "Build me a multiplayer trivia game my friends can play from their phones right now. Theme: internet history. Vibe: neon arcade." \
  --theme "internet history" \
  --vibe "neon arcade" \
  --rounds 6
```

## Run Through OpenClaw UI

Start services:

```bash
./scripts/start
openclaw --profile game-demo dashboard --no-open
```

Use the printed dashboard token to open the UI.

Ask:

```text
Build me a multiplayer trivia game my friends can play from their phones right now. Theme: internet history. Vibe: neon arcade.
```

The chat-facing claw should return a status link, a game link, and a bug report link. The async wrapper is used because build/test/fix/deploy can exceed a chat tool timeout.

## Remote UI From A Laptop

If the demo runs on a Spark or another remote device, tunnel the OpenClaw gateway, report server, and game server:

```bash
ssh -L 18894:127.0.0.1:18894 \
    -L 19001:127.0.0.1:19000 \
    -L 19003:127.0.0.1:19002 \
    <user>@<device>
```

Then open:

- dashboard through the OpenClaw URL/token
- bug report at `http://127.0.0.1:19001/...`
- game at `http://127.0.0.1:19003/`

For phones on the same Wi-Fi as the device, use the device LAN IP and game port instead of `127.0.0.1`.

## Reset For A Fresh Run

```bash
./scripts/reset
```

This kills the report server and generated game server, archives `runs/`, `input/`, and `.generated/` into `.archive/<timestamp>/`, restarts the profile gateway if available, and keeps the OpenClaw profile installed.

For a fully fresh uninstall:

```bash
./scripts/uninstall
```

Use `./scripts/uninstall --yes` only in automation.

## Demo Talk Track

1. Ask for the game prompt and theme.
2. Start the async run from the OpenClaw UI.
3. Open the status page while the loop runs.
4. Open `bug-report.md` and point to the found/fixed issues.
5. Open the game URL on your laptop and phones.
6. Let people join while the bug report stays on screen.

## Known Limits

- The generated app is a same-room demo server with in-memory state. It is not a production hosted game backend.
- The first build intentionally includes defects so the self-fix loop has something real to catch.
- The live link is local to the host or tunnel. For public internet sharing, put the generated game behind a tunnel or static/cloud host with a Node process.
- The default questions are tuned for the sample internet-history trivia prompt.
