#!/bin/sh
# `bun run perf:k6:limit`: finds the highest load the gateway takes with NO
# error. Runs one steady, fixed-VU step after another, each on a fresh stack
# (so a Cooldown from one step cannot leak into the next), and stops at the
# first step that fails. Prints one table at the end.
#   STEPS=...       VU counts to try, lowest first (default "300 600 900 1200 1500 1800")
#   SCENARIO=...    default mixed (the paced upstream); raw is a fixed-rate run, not VUs
#   DURATION=...    length of each step's hold (default 1m)
#   TOPOLOGY=...    dual (default) or single, see run.sh
cd "$(dirname "$0")" || exit 1
STEPS="${STEPS:-300 600 900 1200 1500 1800}"
export PROFILE=steady
export SCENARIO="${SCENARIO:-mixed}"
export DURATION="${DURATION:-1m}"
TOPOLOGY="${TOPOLOGY:-dual}"
export TOPOLOGY
ran=""
for vus in $STEPS; do
  echo "=== $TOPOLOGY, $vus VUs ==="
  VUS=$vus RESULT_NAME="step-$TOPOLOGY-$vus" sh ./run.sh > "results/step-$TOPOLOGY-$vus.out" 2>&1
  status=$?
  ran="$ran $vus"
  if [ "$status" -ne 0 ]; then
    echo "step $vus failed (exit $status): stopping here"
    break
  fi
done
bun ./summarize-steps.js "$TOPOLOGY" $ran
