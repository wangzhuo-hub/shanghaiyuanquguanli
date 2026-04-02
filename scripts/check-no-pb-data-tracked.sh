#!/usr/bin/env bash
# Fail if pocketbase/pb_data/ is tracked by git (runtime DB must not be in the repo).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TRACKED="$(git ls-files pocketbase/pb_data 2>/dev/null || true)"
if [[ -n "$TRACKED" ]]; then
  echo "ERROR: pocketbase/pb_data/ must not be tracked by git. Remove with:" >&2
  echo "  git rm -r --cached pocketbase/pb_data/" >&2
  echo "Tracked files:" >&2
  echo "$TRACKED" >&2
  exit 1
fi
echo "OK: no files under pocketbase/pb_data/ are tracked."
