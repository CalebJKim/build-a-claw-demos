#!/usr/bin/env bash
set -euo pipefail

AGENT_ID="${AGENT_ID:-manufacturing-ops}"
ROOT_DIR="${ROOT_DIR:-/sandbox/manufacturing-agent}"
WORKSPACE_DIR="${WORKSPACE_DIR:-$ROOT_DIR/openclaw-workspace}"
AGENT_DIR="${AGENT_DIR:-/sandbox/.openclaw/agents/$AGENT_ID}"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "openclaw was not found on PATH. Run this inside the NemoClaw/OpenShell sandbox." >&2
  exit 1
fi

if openclaw agents list 2>/dev/null | grep -q "$AGENT_ID"; then
  echo "OpenClaw agent '$AGENT_ID' already exists."
else
  openclaw agents add "$AGENT_ID" \
    --workspace "$WORKSPACE_DIR" \
    --agent-dir "$AGENT_DIR" \
    --non-interactive
fi

cat <<MSG

Agent '$AGENT_ID' is ready.

Try:
  openclaw agent --agent $AGENT_ID --message "Run the manufacturing demo analysis and brief me on maintenance, quality, schedule, and supplier risk."

Or run the deterministic demo tool directly:
  cd $ROOT_DIR
  node scripts/demo-runner.mjs all

MSG

