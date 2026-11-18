#!/bin/sh
# `bun run perf:k6`: the one-command benchmark. Runs the two scenarios, one
# minute each, each on a fresh stack, and prints one table per scenario:
#   1. Gateway -> Client             an instant upstream: the gateway alone
#   2. Upstream -> Gateway -> Client a paced upstream (200 ms, then 100 tokens/s)
# Needs only Docker and Bun. About 6 minutes in all, most of it building.
#   TOPOLOGY=dual         dual (default), single or cluster: see run.sh
#   BENCH_RAW_VUS=300     VUs of scenario 1
#   BENCH_MIXED_VUS=1800  VUs of scenario 2
cd "$(dirname "$0")" || exit 1
mkdir -p results
export TOPOLOGY="${TOPOLOGY:-dual}" PROFILE=bench

echo "1/2 Gateway -> Client (1 minute)"
SCENARIO=raw RESULT_NAME=bench-raw sh ./run.sh > results/bench-raw.out 2>&1
echo "2/2 Upstream -> Gateway -> Client (1 minute)"
SCENARIO=mixed RESULT_NAME=bench-mixed sh ./run.sh > results/bench-mixed.out 2>&1

bun ./summarize-bench.js
