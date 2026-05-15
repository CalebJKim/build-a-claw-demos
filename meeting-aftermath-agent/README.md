# Meeting Aftermath Machine

OpenClaw demo pack for turning a messy meeting transcript into the work that should happen after the meeting.

Audience: managers, team leads, and people who sit in too many meetings.

Ask: "Paste a messy meeting transcript. Get everything that should have happened after it."

Workflow shape: single input -> parallel extraction -> structured output -> draft communications.

## What It Shows

The demo takes a raw Zoom or Teams style transcript and produces:

- a clean meeting summary
- decisions, open questions, and blockers
- action items with owners and evidence
- personalized follow-up emails for each stakeholder
- a PM-tool-ready task list
- clarification prompts for vague commitments

The intended wow moment is the personalized email output. In the included sample, Leo says "I will look into that." The demo keeps that as a visible ambiguity and asks for a concrete deliverable and date instead of pretending it is a real action item.

## Architecture

This is a host-native OpenClaw demo pack. It does not ship its own OpenClaw container. The target device provides OpenClaw, Ollama, and the local model. This directory provides an isolated OpenClaw profile, agent instructions, tools, sample data, and reset/start scripts.

The primary configuration contract is `demo.config.json`. Bootstrap, start, reset, and runner commands read from that manifest so the demo can be moved to another Spark or OpenClaw device without hardcoded paths.

Default profile: `meeting-demo`

Default model: `ollama/qwen3.6:35b-a3b`

Default gateway port: `18891`

Default report server port on the device: `18994`

Default local tunnel port: `18995`

The demo has five claws:

- `main`: chat-facing operator. Routes UI requests to the packaged workflow.
- `extractor`: extracts decisions, open questions, and blockers.
- `owners`: maps commitments to owners and flags ambiguity.
- `comms`: drafts stakeholder-specific follow-up emails.
- `timeline`: builds the PM-tool task list.

The packaged runner in `src/run.js` is the repeatable tool that OpenClaw calls. It keeps the live demo deterministic, fast to reset, and safe to move between devices. The model is still used for summary text during a full run, but the extraction and artifact generation have deterministic fallbacks so the sample can be smoke-tested without waiting on the model.

## What Is Included

- `demo.config.json` - demo-pack manifest: profile, ports, model, agents, required tools, generated paths, and standard commands.
- `agents/*/AGENTS.md` and `agents/*/SOUL.md` - registered OpenClaw agent workspaces and specialist instructions.
- `bin/meeting-aftermath` - dependency-free Node runner entrypoint.
- `bin/meeting-aftermath-chat` - wrapper for OpenClaw dashboard/chat usage.
- `bin/meeting-aftermath-job` - detached async background job runner used by chat.
- `tools/mock-transcript-api` - local mock transcript retrieval tool.
- `data/mock-transcripts/product-sync.yaml` - seeded transcript with explicit decisions, commitments, blockers, and one planted vague commitment.
- `scripts/doctor`, `scripts/bootstrap`, `scripts/start`, `scripts/run-sample`, `scripts/reset`, `scripts/uninstall` - standard repo demo-pack command surface.
- `src/run.js` - orchestrator: transcript loading, parallel extraction, owner mapping, email drafting, timeline generation, model summary, and report rendering.
- `src/write-openclaw-patch.js` - writes the OpenClaw profile patch used by bootstrap.

## OpenClaw Features Used

- Isolated OpenClaw profile: `meeting-demo`, so this demo does not interfere with the user's default profile or other demos.
- Registered claws/agents with separate workspaces and prompts.
- Local model provider configuration for Ollama.
- Dashboard/chat entrypoint through the `main` claw.
- Tool invocation through local wrappers, especially `meeting-aftermath-chat` and `mock-transcript-api`.
- Async background execution so the chat can return a status URL quickly instead of waiting on a long transcript workflow.
- Local report hosting so the generated artifacts can be opened from a laptop through an SSH tunnel.

## Agentic Concepts Demonstrated

- Tool call retrieval: the agent calls a mock transcript API instead of receiving all context inline.
- Parallel specialist analysis: the runner fans out decisions/blockers extraction, owner/action extraction, and timeline seeding before merging results.
- Evidence-grounded extraction: action items and facts retain the exact transcript line that produced them.
- Ambiguity detection: vague commitments such as "I will look into that" are flagged for clarification instead of treated as complete tasks.
- Personalized communication drafting: the comms claw drafts one stakeholder email per owner, scoped to that person's commitments.
- Structured output: the same analysis is rendered as Markdown, CSV, JSON, and an HTML report.

## Tools Used

- OpenClaw CLI, gateway, dashboard, profiles, and registered agents.
- Ollama local model API at `http://127.0.0.1:11434`.
- `tools/mock-transcript-api` for local transcript retrieval.
- Node.js for the packaged workflow runner.
- Python `http.server` for report hosting.
- No npm install is required for the runner.

## Execution Flow

```text
OpenClaw dashboard
      |
      v
main claw
      |
      v
meeting-aftermath-chat
      |
      v
mock-transcript-api or uploaded transcript
      |
      v
extractor     owners     timeline
      \          |          /
       \         |         /
        v        v        v
             merge
              |
              v
       comms + report writer
              |
              v
summary, emails, timeline, clarifications, HTML report
```

## Mock Transcript API

The mock API is intentionally local and simple:

```bash
./tools/mock-transcript-api get product-sync
```

It reads `data/mock-transcripts/product-sync.yaml` and prints a transcript payload with a small API-style header. This gives the OpenClaw operator something that looks and feels like a transcript retrieval tool call without needing a real Zoom, Teams, or calendar integration.

## Outputs

Each run writes a timestamped directory under `runs/` unless `--out` is provided.

Generated files include:

- `index.html` - browser report
- `meeting-summary.md` - shareable summary
- `decisions-open-questions-blockers.md` - extracted facts with evidence
- `draft-emails.md` - all follow-up emails
- `draft-emails/<owner>.md` - one email per stakeholder
- `project-timeline.md` - PM-tool formatted task list
- `clarifications.md` - vague commitments that need follow-up
- `tasks.csv` - task export
- `analysis.json` - structured machine-readable output
- `raw-transcript.txt` - copied input transcript
- `mock-tool-response.yaml` - mock API response, when the mock path is used

Generated state is ignored by git.

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
cd meeting-aftermath-agent
./scripts/doctor
./scripts/bootstrap
./scripts/start
```

`bootstrap` creates or updates only the `meeting-demo` OpenClaw profile. It does not modify the user's default OpenClaw profile.

## Run The Sample

Fast deterministic smoke test:

```bash
./scripts/run-sample --skip-model
```

Async chat-wrapper smoke test:

```bash
./bin/meeting-aftermath-chat --mock-transcript product-sync --async --pm-format linear --skip-model
```

Full local-model run:

```bash
./scripts/run-sample
```

The command prints the generated report path. Open `index.html` from the run directory, or use the report server started by `./scripts/start`.

## Run With A Real Transcript

Save a transcript as text, Markdown, VTT, or SRT:

```bash
mkdir -p input
cp /path/to/transcript.txt input/transcript.txt
./bin/meeting-aftermath run --transcript input/transcript.txt --pm-format linear
```

Supported PM formats:

- `linear`
- `jira`
- `asana`
- `markdown`

## Run Through OpenClaw UI

Start services:

```bash
./scripts/start
openclaw --profile meeting-demo dashboard --no-open
```

Use the printed dashboard token to open the UI.

For the canned mock API demo, ask:

```text
Retrieve the product-sync transcript with the mock transcript API and run the Meeting Aftermath Machine.
```

For a pasted transcript, paste the transcript and ask:

```text
Run the Meeting Aftermath Machine on this transcript and format the timeline for Linear.
```

For an uploaded transcript file, ask:

```text
Use my uploaded transcript and run the Meeting Aftermath Machine.
```

The chat-facing claw should return a status link. The async wrapper is used because transcript processing and artifact generation may exceed a chat tool timeout.

## Remote UI From A Laptop

If the demo runs on a Spark or another remote device, tunnel both the OpenClaw gateway and report server:

```bash
ssh -L 18891:127.0.0.1:18891 -L 18995:127.0.0.1:18994 <user>@<device>
```

Then open the dashboard and reports through localhost on the laptop.

## Reset Between Runs

For a fresh audience or a fresh transcript:

```bash
./scripts/reset
./scripts/start
```

`reset` archives old generated runs and clears `runs/`, `input/`, and `.generated/`. It keeps the `meeting-demo` OpenClaw profile installed so the demo can start quickly again.

## Uninstall

To remove this demo's generated local state:

```bash
./scripts/uninstall
```

This is intended for cleanup after a device no longer needs the demo.

## Files Safe To Commit

Commit:

- `agents/`
- `bin/`
- `data/mock-transcripts/`
- `openclaw/patch.template.json`
- `scripts/`
- `src/`
- `tools/`
- `demo.config.json`
- `package.json`
- docs and examples

Do not commit:

- `.env`
- `.generated/`
- `.archive/`
- `runs/`
- `input/`
- `workspaces/`
- `openclaw/agents/`
- real meeting transcripts
- customer or employee data

## Known Limits

- The mock API is local and file-backed.
- The deterministic extractor expects speaker-prefixed transcript lines such as `Sarah Kim: I will send this by Friday`.
- Upload auto-discovery is limited to text-like transcript files: `.txt`, `.md`, `.vtt`, and `.srt`.
- The demo is designed for local model execution. Very long transcripts may need chunking or a larger context model.
