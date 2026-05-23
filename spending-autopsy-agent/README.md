# OpenClaw Spending Autopsy Demo


> **Try it:** "Drop three months of bank exports. Get the truth."

This demo is for anyone with a bank account and vague financial anxiety.

The user ask is:

> Drop three months of bank exports. Get the truth.

The live demo takes messy CSV bank exports, cleans the data, categorizes spending behavior, flags anomalies, visualizes category spend, and produces a blunt plain-English spending autopsy.

## Demo Shape

Workflow shape: single input -> clean -> categorize -> anomaly detect -> visualize -> narrate.

1. User drops one or more messy CSV bank exports.
2. Cleaner claw normalizes the ledger: dates, signed amounts, merchant names, duplicates, credits, and rejected rows.
3. Categorizer claw labels transactions by behavior, not just generic budget category.
4. Anomaly claw flags weird charges, duplicate rows, recurring subscriptions, category spikes, and large outliers.
5. Narrator claw turns the facts into a plain-English autopsy and a three-item cut list.
6. The runner writes:
   - `index.html`
   - `spending-summary.md`
   - `anomalies.md`
   - `three-cuts.md`
   - `analysis.json`
   - `cleaned-transactions.json`
   - `categorized-transactions.json`
   - `categorized-transactions.csv`

The intended wow moment is the anomaly flag. The sample data includes a suspicious March charge:

```text
MYSTERY TECH SUPPORT CO 855-404-HELP - $340.00
```

## What Is Included

- `demo.config.json` - demo-pack manifest: profile, ports, model, agents, required tools, generated paths, and standard commands.
- `agents/*/AGENTS.md` and `agents/*/SOUL.md` - registered OpenClaw agent workspaces and specialist prompts.
- `bin/spending-autopsy` - dependency-free Node runner.
- `bin/spending-autopsy-chat` - wrapper for OpenClaw dashboard/chat uploads.
- `bin/spending-autopsy-job` - detached async background job runner.
- `scripts/doctor`, `scripts/bootstrap`, `scripts/start`, `scripts/run-sample`, `scripts/reset`, `scripts/uninstall` - standard repo demo-pack command surface.
- `samples/seeded-bank-export.csv` - three months of synthetic transactions with planted anomalies.
- `src/run.js` - orchestrator: CSV parsing, cleanup, categorization, anomaly detection, local model narration, and report rendering.

Generated files are intentionally ignored by git:

- `runs/`
- `input/`
- `workspaces/`
- `.generated/`
- `.archive/`
- `openclaw/agents/`

Do not commit real bank exports, generated reports, OpenClaw state, tokens, or uploaded files.

## Architecture

This is a standalone OpenClaw demo pack. It can be copied to a device that already has OpenClaw and a local model.

The primary configuration contract is `demo.config.json`. Bootstrap and standard scripts read from that manifest so the demo can be moved to another device without hardcoded paths.

Default OpenClaw profile:

```text
spending-demo
```

Default ports:

```text
OpenClaw gateway: 18890
Report server on the OpenClaw host: 18992
Expected local SSH tunnel for reports: 18993
```

Default model:

```text
ollama/qwen3.6:35b-a3b
```

The bootstrap registers these OpenClaw agents in the isolated `spending-demo` profile:

- `main` - chat-facing operator that routes dashboard uploads into the async wrapper.
- `cleaner` - specialist prompt/workspace for CSV cleanup.
- `categorizer` - specialist prompt/workspace for behavioral categories.
- `anomaly` - specialist prompt/workspace for duplicate/spike/weird-charge detection.
- `narrator` - specialist prompt/workspace for blunt summary and cut list.

The verified execution path is the Node orchestrator in `src/run.js`. It performs deterministic ledger analysis and optionally calls the local Ollama model for the final narrative. This keeps the live demo reliable while still exposing the work as named OpenClaw claws.

```text
CSV exports
    |
    v
 cleaner
    |
    v
 categorizer
    |
    v
 anomaly detector
    |
    v
 visual report + narrator
```

Dashboard upload uses `spending-autopsy-chat --async`, which starts the workflow in a detached background job and immediately returns a status URL.

## Prerequisites

On the target device:

- OpenClaw installed and on `PATH`.
- Node.js 22.16 or newer.
- Ollama installed and running.
- The configured model installed in Ollama.
- Python 3 for the report server.
- Chromium or Google Chrome if future PDF export is added.
- Enough memory for the selected local model.

For the default model:

```bash
ollama pull qwen3.6:35b-a3b
```

If your device uses a different model, edit `demo.config.json`:

```json
{
  "model": {
    "id": "qwen3.5:35b-a3b",
    "openclawId": "ollama/qwen3.5:35b-a3b"
  }
}
```

## Set Up On A New Device

From this directory:

```bash
./scripts/doctor
./scripts/bootstrap
./scripts/start
```

`bootstrap` creates:

- `~/.openclaw-spending-demo/openclaw.json`
- profile-specific gateway service `openclaw-gateway-spending-demo`
- local demo workspaces under `workspaces/`
- registered OpenClaw agents for the demo

If ports conflict, change these in `demo.config.json` before bootstrapping:

```json
{
  "ports": {
    "gateway": 18890,
    "report": 18992,
    "localTunnel": 18993
  }
}
```

## Standard Demo Commands

This demo follows the repo demo-pack contract:

```bash
./scripts/doctor       # validate tools, model runtime, and runner dependencies
./scripts/bootstrap    # create/update the isolated spending-demo profile and agents
./scripts/start        # restart gateway and report server, then print dashboard/tunnel info
./scripts/run-sample   # run the seeded synthetic bank export
./scripts/reset        # archive generated state for a fresh chat/demo
./scripts/uninstall    # remove generated state and the spending-demo OpenClaw profile
```

## Run A Smoke Test

```bash
./scripts/run-sample --skip-model
```

Use `--skip-model` for fast deterministic validation. For the full narration path:

```bash
./scripts/run-sample
```

Open the generated report:

```text
runs/<run-id>/index.html
```

## Run With Real CSV Exports

Copy bank exports into ignored local input:

```bash
mkdir -p input
cp /path/to/bank-export.csv input/
```

Run one or more files:

```bash
./bin/spending-autopsy run \
  --csv input/bank-export.csv \
  --household "Avery" \
  --location "San Francisco, CA"
```

The parser handles common messy headers such as `Date`, `Posted Date`, `Description`, `Details`, `Amount`, `Debit`, `Credit`, `Withdrawal`, and `Deposit`.

## Open The Dashboard From Another Machine

If OpenClaw is running on a remote device such as Spark, tunnel the dashboard and report server:

```bash
ssh -L 18890:127.0.0.1:18890 \
    -L 18993:127.0.0.1:18992 \
    <user>@<host>
```

Get the dashboard URL/token on the remote device:

```bash
openclaw --profile spending-demo dashboard --no-open
```

Open:

```text
http://127.0.0.1:18890/#token=<token>
```

## Run From OpenClaw Dashboard Upload

1. Open the `spending-demo` dashboard.
2. Start a fresh chat.
3. Upload one or more CSV bank exports.
4. Ask:

```text
Give me the spending autopsy for these three months.
```

The `main` agent is instructed to run:

```bash
/path/to/spending-autopsy-agent/bin/spending-autopsy-chat \
  --latest-upload \
  --async \
  --household "Avery" \
  --location "San Francisco, CA"
```

The async wrapper returns a status page quickly. When the background job completes, that status page links to the report and anomaly file.

If the chat model ever improvises instead of returning the status link, run the wrapper manually:

```bash
./bin/spending-autopsy-chat \
  --latest-upload \
  --async \
  --household "Avery" \
  --location "San Francisco, CA"
```

## Swap Or Fresh-Start Reset

This keeps the installed `spending-demo` profile and claws, but archives generated demo state:

```bash
cd /path/to/spending-autopsy-agent
./scripts/reset
```

Start a fresh dashboard chat after the restart.

To swap to another demo, reset this one and then start the next demo's profile:

```bash
cd /path/to/spending-autopsy-agent
./scripts/reset

cd ../another-demo
./scripts/doctor
./scripts/bootstrap
./scripts/start
```

To remove this demo profile entirely:

```bash
./scripts/uninstall
```

## Known Limitations

- CSV parsing is local and dependency-free. It handles common bank exports, but every bank has its own quirks.
- The runner does not use OCR or PDF bank statements.
- Categorization is rule-based for reliability, with local model narration layered on top.
- The output is a spending analysis demo, not financial, tax, legal, or debt advice.
- Dashboard upload is asynchronous by design. The chat should return a status URL rather than wait for the full workflow.

## Demo Talk Track

Use the seeded CSV first. It contains enough ordinary spending to feel real and one planted suspicious charge for the room.

Recommended live flow:

1. Upload `samples/seeded-bank-export.csv`.
2. Ask for a spending autopsy.
3. Open the status page.
4. Show the visual category breakdown.
5. Show the anomaly flag for the `$340` mystery tech-support charge.
6. Finish with the three-cut list.

The point is not a prettier budget. The point is showing the user the charge or habit they forgot they were paying for.