#!/bin/sh
# LobakAI v2 — run backend (Bun+Hono) and frontend (Vite preview) together.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

# Backend on :20129
(cd "$ROOT/backend" && exec bun run start) &
BACKEND_PID=$!

# Frontend preview on :20130 (proxies /api,/v1,/v1beta,/responses,/codex to backend)
(cd "$ROOT/frontend" && exec bun run preview) &
FRONTEND_PID=$!

stop() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}

trap 'stop; exit 0' INT TERM

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

stop
exit 1
