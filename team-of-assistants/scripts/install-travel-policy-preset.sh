#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${NEMOCLAW_SOURCE_DIR:-$HOME/.nemoclaw/source}"
PRESET_DIR="$SOURCE_DIR/nemoclaw-blueprint/policies/presets"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$PRESET_DIR" ]]; then
  echo "Could not find NemoClaw preset directory: $PRESET_DIR" >&2
  echo "Set NEMOCLAW_SOURCE_DIR to the directory that contains nemoclaw-blueprint." >&2
  exit 1
fi

install -m 0644 "$ROOT_DIR/nemoclaw/policies/travel-demo.yaml" "$PRESET_DIR/travel-demo.yaml"
echo "Installed travel-demo policy preset into $PRESET_DIR"
