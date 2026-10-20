#!/bin/bash
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FX=$ROOT/fixtures
: "${CHATAPP_REPO:?CHATAPP_REPO must point to the ChatApp git repo}"
R=$CHATAPP_REPO
[ -d "$R/.git" ] || [ -f "$R/.git" ] || { echo "CHATAPP_REPO is not a git repo: $R" >&2; exit 2; }
for f in clean-1 clean-2 g45 g46 g46-tur1; do
  D=/tmp/homework-olcum/$f; rm -rf $D; mkdir -p $D
  base=$(cat $FX/$f/base.txt)
  git -C $R archive $base | tar -x -C $D
  ( cd $D && git init -q && git add -A && git -c user.name=m -c user.email=m@m commit -qm base && echo "$f base ok files=$(git ls-files | wc -l)"
    if git apply --check $FX/$f/change.diff 2>/tmp/homework-olcum/$f.apply.err; then git apply $FX/$f/change.diff && echo "$f apply ok: $(git status --short | wc -l) changed"; else echo "$f APPLY FAIL"; head -5 /tmp/homework-olcum/$f.apply.err; fi )
done
