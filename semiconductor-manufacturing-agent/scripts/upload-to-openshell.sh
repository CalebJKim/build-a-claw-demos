#!/usr/bin/env bash
set -euo pipefail

SANDBOX="${1:-my-assistant}"
DEST="${2:-/sandbox/manufacturing-agent}"

if ! command -v openshell >/dev/null 2>&1; then
  echo "openshell was not found on PATH." >&2
  exit 1
fi

openshell sandbox upload "$SANDBOX" . "$DEST"

cat <<MSG

Uploaded manufacturing agent demo to $SANDBOX:$DEST

Next:
  nemoclaw $SANDBOX connect

Then inside the sandbox:
  cd $DEST
  ./scripts/bootstrap-openclaw-agent.sh
  node scripts/demo-runner.mjs all

MSG

