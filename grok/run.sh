#!/usr/bin/env bash
# Sync wrapper: pull latest book (mark.py commits every 10 min), run a grok command, commit + push its outputs.
#   grok/run.sh trade.py open --coin SOL --side long --stop 95 --target 110 --thesis "..."
#   grok/run.sh snapshot.py      (read-only commands are run after a pull, nothing committed)
set -u
cd "$(dirname "$0")/.."
git pull -q --rebase || { echo "pull failed — resolve manually"; exit 1; }
python3 "grok/$1" "${@:2}"; rc=$?
FILES="grok/book.json grok/journal.jsonl grok/skeptic.jsonl"
touch grok/skeptic.jsonl
if ! git diff --quiet -- $FILES || [ -n "$(git ls-files --others --exclude-standard -- $FILES)" ]; then
  git add $FILES && git commit -qm "grok: $1 ${2:-} $(date -u +%H:%MZ)"
  for i in 1 2 3 4; do
    git push -q && { echo "pushed"; exit $rc; }
    git pull -q --rebase || { git rebase --abort; echo "CONFLICT with mark bot: run 'git reset --hard origin/main' and redo the command"; exit 4; }
  done
  echo "push failed"; exit 5
fi
exit $rc
