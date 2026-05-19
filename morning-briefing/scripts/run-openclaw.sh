#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
session_id="morning-briefing-$(date +%Y-%m-%d)"
openclaw agent --agent main --local -m "$(cat prompts/morning-briefing.md)" --session-id "$session_id"
