# LobakAI Backend

The backend uses Bun, Hono, Drizzle, and SQLite.

## Commands

Run these commands from the repository root.

```bash
bun run dev:backend
bun run start:backend
bun run test:backend
bun run typecheck:backend
```

The default listener is `127.0.0.1:20129`.

Set `BACKEND_HOST=0.0.0.0` inside a container.

## Database

Set `BACKEND_DATABASE_PATH` to select the SQLite database file.

The default path is `${DATA_DIR}/db/data.sqlite`.

The default `DATA_DIR` is `~/.lobakai`.

Use a separate data directory for tests and development.

## Legacy database import

Set `LEGACY_DATABASE_PATH` to an external legacy SQLite database.

Run the importer with this command.

```bash
bun run --cwd backend import:legacy
```

The importer reads the source database without modifying it.

## Load test

The load-test harness starts the real server, a mock Provider, and a load generator.

Run it from the `backend` directory.

```bash
bun run loadtest -- --streams 200 --rps 20 --duration 20
```

Run `bun run loadtest -- --help` to see all options.

`bun test` does not run the harness.

## Runtime stats

`GET /api/usage/runtime-stats` returns event-loop lag, memory, and the slow-query count.

`POST /api/usage/runtime-stats/reset` clears the event-loop lag histogram.

Set `SLOW_QUERY_MS` to log SQLite queries slower than that value. The default is `100`. The value `0` turns the log off.

## Product service layout

`src/services/` holds typed product domains.

Domains are `chat`, `providers`, `billing`, `media`, `platform`, `common`.

Edit any domain freely.
