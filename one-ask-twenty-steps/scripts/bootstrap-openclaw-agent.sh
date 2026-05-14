#!/usr/bin/env bash
set -euo pipefail

AGENT_ID="${AGENT_ID:-one-ask-workflow}"
ROOT_DIR="${ROOT_DIR:-/sandbox/one-ask-workflow}"
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
  openclaw agent --agent $AGENT_ID --message "Run the one-ask reading-list workflow for: Put together a reading list on personal finance for a beginner."

Or run the deterministic demo tool directly:
  cd $ROOT_DIR
  node scripts/demo-runner.mjs

MSG
