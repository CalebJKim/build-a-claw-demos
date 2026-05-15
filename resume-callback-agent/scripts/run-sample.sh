#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

./bin/resume-claw run \
  --resume samples/anonymized-resume.md \
  --target-role "Customer Success Manager" \
  --location "San Francisco, CA"
