#!/usr/bin/env bash
# Runs every automated check and prints one line per step. Full output goes to .verify-logs/;
# a failing step also prints the last lines of its log. No screenshots are taken or read.
# Usage: bash verify.sh   (or npm run verify)
cd "$(dirname "$0")" || exit 1
LOGS=.verify-logs
mkdir -p "$LOGS"
failed=0

step() {
  local name=$1; shift
  local log="$LOGS/$name.log" start=$SECONDS
  if "$@" >"$log" 2>&1; then
    echo "PASS $name ($((SECONDS - start))s)"
  else
    echo "FAIL $name ($((SECONDS - start))s) - full log: $log"
    tail -n 15 "$log"
    failed=1
  fi
}

[ -e node_modules/.bin/vite ] || step install npm install --no-audit --no-fund
step browser npx playwright install chromium
step typecheck npm run --silent typecheck
step check npm run --silent check
step build npm run --silent build
if [ "$failed" -eq 0 ]; then
  rm -f "$LOGS"/v6-compare*.txt
  step test npx playwright test --reporter=dot
  grep -E '^[[:space:]]*[0-9]+ (passed|failed|flaky|skipped)' "$LOGS/test.log" | sort -u
  for f in "$LOGS"/v6-compare*.txt; do
    [ -f "$f" ] || continue
    echo "$(basename "$f"): $(grep -c '^same' "$f") same, $(grep -c '^DIFF' "$f") different"
    grep '^DIFF' "$f" | cut -c1-220
  done
else
  echo "SKIP test (an earlier step failed)"
fi

[ "$failed" -eq 0 ] && echo "ALL PASSED" || echo "SOME FAILED"
exit "$failed"
