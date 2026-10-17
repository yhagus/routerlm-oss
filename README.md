<p align="center"><img src="frontend/public/logo.svg" alt="LobakAI" width="320" /></p>

# LobakAI

LobakAI provides a local AI gateway and dashboard.

The gateway supports OpenAI-compatible and provider-specific endpoints.

The backend uses Bun, Hono, and SQLite.

The dashboard uses Vue and Vite.

## Requirements

Install Bun 1.3.14 or a compatible later release.

Use a supported macOS, Linux, or Windows environment.

## Start from source

Install workspace dependencies.

```bash
bun install
```

Configure the backend before production use.

```bash
cp backend/.env.example backend/.env
```

Set `JWT_SECRET` and `INITIAL_PASSWORD` in `backend/.env`.

Start the backend in one terminal.

```bash
bun run dev:backend
```

Start the frontend in another terminal.

```bash
bun run dev:frontend
```

Open the dashboard at `http://127.0.0.1:20130`.

Send gateway requests to `http://127.0.0.1:20129/v1`.

## Production commands

Build the dashboard before previewing it.

```bash
bun run build
bun run start:backend
```

Start the dashboard preview in another process.

```bash
bun run preview:frontend
```

Use `ecosystem.config.cjs` for PM2 deployments.

Use `docker compose up -d` for Docker deployments.

## Verification

Run the complete validation suite before release.

```bash
bun run typecheck
bun run test
```

## Data migration

The backend can import a legacy SQLite database once.

Set `LEGACY_DATABASE_PATH` to the source database.

Run `bun run --cwd backend import:legacy`.

The importer does not modify the source database.

## Documentation

Read `gitbook/content/en/` for user documentation sources.
