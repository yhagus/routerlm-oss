#!/usr/bin/env bash
# Boots deploy/compose.yaml against images already present locally and checks
# that migrate exits 0, the backend's /health answers 200 and the web app
# answers 200. Removes the stack and its volumes afterwards, pass or fail.
#
#   ROUTERLM_VERSION=<local tag> scripts/smoke-production.sh
#
# Runs under its own project name and free-ish ports so it never touches a
# real install's routerlm-oss volumes.
set -euo pipefail

: "${ROUTERLM_VERSION:?set ROUTERLM_VERSION to the tag of the local images}"
cd "$(dirname "$0")/../deploy"

export COMPOSE_PROJECT_NAME="routerlm-smoke-$$"
export ENCRYPTION_KEY="$(openssl rand -base64 32)"
export POSTGRES_PASSWORD="smoke-$$"
export BACKEND_PORT="${BACKEND_PORT:-43000}"
export WEB_PORT="${WEB_PORT:-43001}"
compose=(docker compose -f compose.yaml)

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then "${compose[@]}" logs --no-color || true; fi
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

# The RouterLM images under test were built here and are already present, so
# only Postgres and Redis get pulled.
"${compose[@]}" up -d

wait_for() { # url, label
  for _ in $(seq 1 60); do
    if curl -fs -o /dev/null "$1"; then echo "ok: $2"; return 0; fi
    sleep 2
  done
  echo "timed out waiting for $2 ($1)" >&2
  return 1
}

wait_for "http://localhost:$BACKEND_PORT/health" "backend /health"
wait_for "http://localhost:$WEB_PORT/" "web"

migrate_exit="$(docker inspect -f '{{.State.ExitCode}}' "$("${compose[@]}" ps -aq migrate)")"
if [ "$migrate_exit" != "0" ]; then
  echo "migrate exited with $migrate_exit" >&2
  exit 1
fi
echo "ok: migrate exited 0"
