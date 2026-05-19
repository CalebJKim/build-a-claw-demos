#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

sandbox_name="${1:-my-assistant}"
remote_path="${2:-/sandbox/morning-briefing}"

if ! command -v yq >/dev/null 2>&1; then
  echo "yq is required to merge the live OpenShell policy with the demo policy overlay." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

current_policy="${tmp_dir}/current-policy.yaml"
merged_policy="${tmp_dir}/merged-policy.yaml"

echo "Reading active OpenShell policy from ${sandbox_name}..."
openshell policy get --full "${sandbox_name}" | awk 'found { print } /^---$/ { found = 1 }' > "${current_policy}"

echo "Merging morning briefing policy overlay..."
yq eval-all 'select(fileIndex == 0) * select(fileIndex == 1)' \
  "${current_policy}" \
  openshell/morning-briefing-policy.yaml \
  > "${merged_policy}"

echo "Applying merged OpenShell policy to ${sandbox_name}..."
openshell policy set --policy "${merged_policy}" --wait "${sandbox_name}"

echo "Uploading demo files to ${sandbox_name}:${remote_path}..."
openshell sandbox upload "${sandbox_name}" . "${remote_path}"

cat <<MSG
Uploaded.

Next:
  nemoclaw ${sandbox_name} connect
  cd ${remote_path}
  npm run demo
  npm run schedule
MSG
