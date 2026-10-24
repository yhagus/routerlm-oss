<p align="center"><img src="frontend/public/logo.svg" alt="LobakAI" width="320" /></p>

# LobakAI

LobakAI provides a local AI gateway and dashboard.

The gateway supports OpenAI-compatible and provider-specific endpoints.

The backend uses Bun, Hono, and SQLite.

The dashboard uses Vue and Vite.

## Requirements

Install Bun 1.3.14 or a compatible later release.

Use a supported macOS, Linux, or Windows environment.

## Install with npm

Install the `@ciwergrp/routerlm` package globally and start it with the `routerlm` command.

```bash
npm install -g @ciwergrp/routerlm
routerlm
```

The package ships Bun, so you only need Node.js 18 or later.

The dashboard opens at `http://localhost:20130/dashboard`.

See [cli/README.md](cli/README.md) for every option and the `connect` and `show` commands.

## Publish the npm package

Each `v*.*.*` tag push publishes `@ciwergrp/routerlm` to npm with the version from the tag.

The workflow reads an npm automation token from the `NPM_TOKEN` repository secret.

A tag with a suffix, such as `v1.3.0-beta.1`, publishes under the `next` dist-tag.

Build the package locally with `bun run build:cli`. The output lands in `cli/dist`.

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
