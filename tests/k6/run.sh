#!/bin/sh
# `bun run perf:k6`: builds and starts the stack, runs k6 against the
# gateway, and always removes the stack afterwards. Exits with k6's status.
#   TOPOLOGY=dual|single|cluster
#                          dual (default): 2 replicas of 1 CPU / 1 GB behind nginx
#                          single: 1 process of 2 CPUs / 2 GB
#                          cluster: 1 container of 2 CPUs / 2 GB running 2
#                          processes on one port (BACKEND_PROCESSES=2)
#   PROFILE=smoke|load|stress|steady   (default smoke)
#   SCENARIO=raw|mixed|edge|upstream|all|<one scenario name>   (default mixed)
#   VUS, DURATION          for PROFILE=steady
#   RESULT_NAME            also keeps results/<name>.json, .stats.log, .logs.txt
cd "$(dirname "$0")" || exit 1
mkdir -p results
TOPOLOGY="${TOPOLOGY:-dual}"
export COMPOSE_PROFILES="$TOPOLOGY"
case "$TOPOLOGY" in
  dual)
    gateways="backend-a backend-b"
    services="backend-a backend-b lb worker"
    export BASE_URL="http://lb:8080"
    ;;
  single)
    gateways="backend"
    services="backend worker"
    export BASE_URL="http://backend:3000"
    ;;
  cluster)
    gateways="backend-cluster"
    services="backend-cluster worker"
    export BASE_URL="http://backend-cluster:3000"
    ;;
  *)
    echo "TOPOLOGY must be dual, single or cluster" >&2
    exit 1
    ;;
esac
# The body limit and token estimate the k6 script tests, from the gateway source.
gateway_limits="$(bun ./gateway-limits.ts)" || exit 1
eval "$gateway_limits"
# `backend` builds the image all gateway services share.
docker compose --profile single build backend seed || exit 1
# shellcheck disable=SC2086
if docker compose up --detach --wait $services; then
  # CPU and memory of every container about every 5 s (docker stats takes ~3 s).
  (while :; do
    date +%T
    docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}'
    sleep 2
  done) > results/stats.log 2>&1 &
  sampler=$!
  docker compose run --rm --no-deps k6
  status=$?
  kill "$sampler" 2>/dev/null
  # The last lines each service logged: errors from the gateway or the upstream.
  # shellcheck disable=SC2086
  docker compose logs --no-color --tail 15 $gateways fake-upstream worker > results/service-logs.txt 2>&1
  # What each gateway container says about itself, e.g. an out-of-memory kill.
  for gateway in $gateways; do
    docker inspect --format "$gateway: oom_killed={{.State.OOMKilled}} restarts={{.RestartCount}}" \
      "$(docker compose ps --quiet "$gateway")" 2>/dev/null
  done
  if [ -n "$RESULT_NAME" ]; then
    cp results/summary.json "results/$RESULT_NAME.json" 2>/dev/null
    cp results/stats.log "results/$RESULT_NAME.stats.log" 2>/dev/null
    cp results/service-logs.txt "results/$RESULT_NAME.logs.txt" 2>/dev/null
  fi
else
  status=1
  docker compose logs --no-color --tail 40
fi
docker compose down --volumes --remove-orphans
exit $status
