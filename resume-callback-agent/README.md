# OpenClaw Resume Callback Demo

This demo is for job seekers, career changers, and anyone who has sent a resume into the void.

The user ask is:

> My resume is not getting callbacks. Fix it.

The live demo takes a resume PDF, researches the current job market for a target role, scores the resume against that market, pulls salary signals, and produces a blunt callback diagnosis plus an upgraded downloadable resume.

## Demo Shape

Workflow shape: fan-out -> parallel analysis -> merge -> rewrite -> ranked output.

1. User drops a PDF resume.
2. Job-market claw searches current job postings for the target role and extracts what hiring managers actually want.
3. Resume-gap claw scores the resume against those postings and finds weak verbs, missing keywords, evidence gaps, and formatting red flags.
4. Salary claw pulls current salary signals for the role and location.
5. Lead claw synthesizes the three specialist outputs, rewrites the weakest resume sections, and produces:
   - `upgraded-resume.md`
   - `upgraded-resume.html`
   - `upgraded-resume.pdf`
   - `why-no-callbacks.md`
   - `top-roles.md`
   - `index.html`
6. Evidence-guard claw compares the rewritten resume against the original resume and removes unsupported claims or turns them into placeholders.

The intended wow moment is `why-no-callbacks.md`: a blunt, specific explanation of why the resume was not getting callbacks.

## What Is Included

- `bin/resume-claw` - dependency-free Node runner for the full workflow.
- `bin/bootstrap` - creates an isolated OpenClaw profile, registers demo agents, and installs a profile-specific gateway.
- `bin/resume-claw-chat` - wrapper for OpenClaw dashboard/chat uploads. It can find the latest uploaded resume and start the long-running workflow asynchronously.
- `bin/resume-claw-job` - detached background job runner used by chat uploads.
- `claws/*.md` - modular specialist prompts.
- `openclaw/templates/*.AGENTS.md` - workspace instructions installed into OpenClaw agent workspaces.
- `src/run.js` - orchestrator: PDF extraction, web search, parallel claw execution, merge, evidence guard, and output rendering.
- `src/write-openclaw-patch.js` - writes the OpenClaw profile patch used by bootstrap.
- `samples/anonymized-resume.md` - safe sample resume for smoke tests.
- `resume-claw.config.json` - profile, ports, model, and search settings.

Generated files are intentionally ignored by git:

- `runs/`
- `input/`
- `workspaces/`
- `.generated/`
- `openclaw/agents/`

Do not commit real resumes, generated reports, OpenClaw state, tokens, or uploaded files.

## Architecture

This is a standalone claw pack. It can be copied to a device that already has OpenClaw and a local model.

Default OpenClaw profile:

```text
resume-demo
```

Default ports:

```text
OpenClaw gateway: 18889
Report server on the OpenClaw host: 18990
Expected local SSH tunnel for reports: 18991
```

Default model:

```text
ollama/qwen3.6:35b-a3b
```

The bootstrap registers these OpenClaw agents in the isolated `resume-demo` profile:

- `main` - chat-facing operator that routes dashboard uploads into the async wrapper.
- `job-market` - specialist prompt/workspace for market analysis.
- `resume-gap` - specialist prompt/workspace for scoring the resume.
- `salary` - specialist prompt/workspace for salary signals.
- `lead` - specialist prompt/workspace for synthesis.

The verified execution path is the Node orchestrator in `src/run.js`. It calls the modular claw prompts directly against Ollama. The three specialist claws run in parallel with `Promise.all`:

```text
resume + live search
        |
        v
 job-market   resume-gap   salary
      \          |          /
       \         |         /
        v        v        v
             lead
              |
              v
        evidence-guard
              |
              v
          final outputs
```

The OpenClaw agents are still registered and usable, but the production demo path avoids agent-to-agent chat chaining because local model runs can exceed UI/tool timeouts. Dashboard upload uses `resume-claw-chat --async`, which starts the full workflow in a detached background job and immediately returns a status URL.

## Tools Used

- OpenClaw CLI and dashboard.
- Ollama local model API at `http://127.0.0.1:11434`.
- `pdftotext` for text-based PDF extraction.
- DuckDuckGo HTML search plus direct page fetches for live job and salary evidence.
- Headless Chromium for `upgraded-resume.pdf` rendering when available.
- Python `http.server` for report hosting.
- No npm install is required for the runner.

## Prerequisites

On the target device:

- OpenClaw installed and on `PATH`.
- Node.js 20 or newer.
- Ollama installed and running.
- The configured model installed in Ollama.
- `pdftotext` for PDF resumes.
- Chromium or Google Chrome if you want automatic PDF rendering.
- Enough memory for the selected local model.

For the default model:

```bash
ollama pull qwen3.6:35b-a3b
```

If your device uses a different model, edit `resume-claw.config.json`:

```json
{
  "model": "qwen3.5:35b-a3b",
  "openclawModel": "ollama/qwen3.5:35b-a3b"
}
```

## Set Up On A New Device

From this directory:

```bash
./bin/bootstrap
./bin/resume-claw doctor
```

`bootstrap` creates:

- `~/.openclaw-resume-demo/openclaw.json`
- profile-specific gateway service `openclaw-gateway-resume-demo`
- local demo workspaces under `workspaces/`
- registered OpenClaw agents for the demo

If ports conflict, change these in `resume-claw.config.json` before bootstrapping:

```json
{
  "gatewayPort": 18889,
  "remoteReportPort": 18990,
  "localReportPort": 18991
}
```

Repo-style wrapper:

```bash
./scripts/bootstrap-openclaw-demo.sh
```

## Run A Smoke Test

```bash
./scripts/run-sample.sh
```

or:

```bash
./bin/resume-claw run \
  --resume samples/anonymized-resume.md \
  --target-role "Customer Success Manager" \
  --location "San Francisco, CA"
```

Open the generated report:

```text
runs/<run-id>/index.html
```

## Run With A Real PDF

Use a text-based PDF exported from Word, Google Docs, Pages, Canva, or similar:

```bash
mkdir -p input
cp /path/to/resume.pdf input/resume.pdf

./bin/resume-claw run \
  --resume input/resume.pdf \
  --target-role "ML Infrastructure Engineer" \
  --location "San Francisco, CA"
```

Scanned/image-only PDFs are not supported yet unless OCR is added.

## Open The Dashboard From Another Machine

If OpenClaw is running on a remote device such as Spark, tunnel the dashboard and report server:

```bash
ssh -L 18889:127.0.0.1:18889 \
    -L 18991:127.0.0.1:18990 \
    <user>@<host>
```

Get the dashboard URL/token on the remote device:

```bash
openclaw --profile resume-demo dashboard --no-open
```

Open:

```text
http://127.0.0.1:18889/#token=<token>
```

## Run From OpenClaw Dashboard Upload

1. Open the `resume-demo` dashboard.
2. Start a fresh chat.
3. Upload a resume PDF.
4. Ask:

```text
Fix this resume for ML Infrastructure Engineer roles in San Francisco, CA.
```

The `main` agent is instructed to run:

```bash
/path/to/resume-callback-agent/bin/resume-claw-chat \
  --latest-upload \
  --async \
  --target-role "ML Infrastructure Engineer" \
  --location "San Francisco, CA"
```

The async wrapper returns a status page quickly. When the background job completes, that status page links to the report and upgraded resume PDF.

If the chat model ever improvises instead of returning the status link, run the wrapper manually:

```bash
./bin/resume-claw-chat \
  --latest-upload \
  --async \
  --target-role "ML Infrastructure Engineer" \
  --location "San Francisco, CA"
```

## Safe Fresh-Start Reset

This keeps the installed profile and claws, but archives generated demo state:

```bash
cd /path/to/resume-callback-agent
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p .archive/$stamp

mv runs .archive/$stamp/runs 2>/dev/null || true
mv input .archive/$stamp/input 2>/dev/null || true

mkdir -p runs input
openclaw --profile resume-demo gateway restart
```

Start a fresh dashboard chat after the restart.

## Known Limitations

- PDF extraction requires text-based PDFs. Add OCR for scanned resumes.
- Live search uses public web search snippets and fetched pages, so source quality varies by role/location.
- The local model can occasionally return malformed JSON. The runner includes JSON repair and an evidence-guard pass, but narrow target roles produce better results than broad prompts like "Software".
- Dashboard upload is asynchronous by design. The chat should return a status URL rather than wait for the full model workflow.
- The registered OpenClaw specialist agents are modular workspaces, but the verified fast path is orchestrator-driven prompt execution, not separate agent-to-agent conversations.

## Demo Talk Track

Use a real anonymized resume. The stronger the gaps, the better the reaction.

Recommended live flow:

1. Upload the resume.
2. Ask for a specific target role/location.
3. Open the status page.
4. Show `why-no-callbacks.md` first.
5. Then show `top-roles.md`.
6. Finish with `upgraded-resume.pdf`.

The point is not just a prettier resume. The point is showing the candidate why their old resume failed the market they were actually applying into.
