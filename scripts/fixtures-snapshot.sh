#!/bin/bash
# Extract the base-revision content of every file a fixture's change.diff modifies or deletes
# into fixtures/<name>/base/, so the regression tests can rebuild the pre-change tree without
# access to the ChatApp repository (CI has none). Read-only on CHATAPP_REPO.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FX="$ROOT/fixtures"
: "${CHATAPP_REPO:?CHATAPP_REPO must point to the ChatApp git repo}"
R="$CHATAPP_REPO"
git -C "$R" rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repo: $R" >&2; exit 2; }

for dir in "$FX"/*/; do
  f="$(basename "$dir")"
  [ -f "$dir/change.diff" ] && [ -f "$dir/base.txt" ] || continue
  base="$(tr -d '[:space:]' < "$dir/base.txt")"
  out="$dir/base"
  rm -rf "$out"
  mkdir -p "$out"
  n=0
  # Only "--- a/<path>" sides exist in the base; new files ("--- /dev/null") need no snapshot.
  while IFS= read -r p; do
    case "$p" in ''|/*|*..*) echo "skip suspicious path: $p" >&2; continue ;; esac
    mkdir -p "$out/$(dirname "$p")"
    git -C "$R" show "$base:$p" > "$out/$p"
    n=$((n + 1))
  done < <(sed -n 's|^--- a/||p' "$dir/change.diff" | sed 's/\t.*$//' | sort -u)
  echo "$f: $n base file(s) from $base"
done
