#!/usr/bin/env bash
# Boots deploy/compose.yaml against images already present locally and checks
# that migrate exits 0, Caddy routes /health and /v1 to inference and
# /integration/v1 to admin, keeps /api off the API port, and serves the web
# app. Removes the stack and its volumes afterwards, pass or fail.
#
#   ROUTERLM_VERSION=<local tag> scripts/smoke-production.sh
#
# Runs under its own project name, subnet and free-ish ports so it never
# touches a real install's routerlm-oss volumes or network.
set -euo pipefail

: "${ROUTERLM_VERSION:?set ROUTERLM_VERSION to the tag of the local images}"
cd "$(dirname "$0")/../deploy"

export COMPOSE_PROJECT_NAME="routerlm-smoke-$$"
export ENCRYPTION_KEY="$(openssl rand -base64 32)"
export POSTGRES_PASSWORD="smoke-$$"
export BACKEND_PORT="${BACKEND_PORT:-43000}"
export WEB_PORT="${WEB_PORT:-43001}"
export HTTP_PORT="${HTTP_PORT:-43080}"
export HTTPS_PORT="${HTTPS_PORT:-43443}"
export ROUTERLM_SUBNET="${ROUTERLM_SUBNET:-172.29.85.0/24}"
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

wait_for "http://localhost:$BACKEND_PORT/health" "inference /health"
wait_for "http://localhost:$WEB_PORT/" "web"

expect_status() { # url, status, label
  actual="$(curl -s -o /dev/null -w '%{http_code}' "$1")"
  if [ "$actual" != "$2" ]; then
    echo "$3: expected $2 from $1, got $actual" >&2
    return 1
  fi
  echo "ok: $3"
}

expect_status "http://localhost:$BACKEND_PORT/v1/models" 401 "inference serves /v1"
expect_status "http://localhost:$BACKEND_PORT/integration/v1/models" 401 "admin serves /integration/v1"
expect_status "http://localhost:$BACKEND_PORT/api/auth/me" 404 "/api is not on the API port"
expect_status "http://localhost:$WEB_PORT/api/auth/me" 401 "web reaches admin's /api"

migrate_exit="$(docker inspect -f '{{.State.ExitCode}}' "$("${compose[@]}" ps -aq migrate)")"
if [ "$migrate_exit" != "0" ]; then
  echo "migrate exited with $migrate_exit" >&2
  exit 1
fi
echo "ok: migrate exited 0"
