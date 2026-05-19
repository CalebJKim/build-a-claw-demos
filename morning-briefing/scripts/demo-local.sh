#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
node src/morning-briefing.mjs --demo --dry-run "$@"
