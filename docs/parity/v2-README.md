# Archived v2 migration record

This record describes the former `v2/` workspace layout.

The backend, frontend, and scripts now live at the repository root.

Do not use the commands below for current development.

# LobakAI v2

This directory is an isolated Bun workspace for the next LobakAI architecture.
It does not participate in the legacy Next.js build or runtime.

## Backend

```bash
bun install --cwd v2
bun run --cwd v2 dev:backend
bun run --cwd v2 test:backend
bun run --cwd v2 typecheck:backend
```

The Hono backend listens on `127.0.0.1:20129` by default. During the initial
migration it only accepts loopback bind addresses and does not own legacy
database state or receive production traffic.

## Frontend

The Vite + Vue operator console listens on `127.0.0.1:20130` and proxies
`/api`, `/v1`, `/v1beta`, `/responses`, and `/codex` to the backend.

```bash
bun run --cwd v2 dev:frontend
bun run --cwd v2 typecheck:frontend
bun run --cwd v2 build:frontend
```

The frontend currently connects the v2 management surface for providers,
provider nodes, proxy pools, models, combos, API keys, usage, and settings.
Unimplemented backend capabilities are shown as explicit unavailable states
rather than fixture data.

## Parity Verification

Generate the legacy route inventory after adding or removing a legacy route:

```bash
bun run --cwd v2 parity:manifest
```

The generated `v2/parity-manifest.generated.json` lists every legacy API route,
its source, initial v2 owner, and current verification status. Compare only
read-only fixtures against separate running v1 and v2 instances:

```bash
V1_BASE_URL=http://127.0.0.1:20128 V2_BASE_URL=http://127.0.0.1:20129 \
  bun run --cwd v2 parity:diff
```

Use `bun run --cwd v2 parity:hash-root-db` before and after any migration
verification run to confirm the root v1 database was not changed.

For mutation comparisons, make two disposable SQLite backups. The command
refuses to overwrite an existing target and uses SQLite's `.backup` operation
instead of copying a potentially active database file:

```bash
PARITY_WORK_DIR=/tmp/lobakai-v2-parity-$(date +%s) \
  bun run --cwd v2 parity:prepare-databases
```

Start v1 with the printed `V1_DATA_DIR` and v2 with the printed
`BACKEND_DATABASE_PATH`. Run mutations only against those disposable copies.
