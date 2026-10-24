<p align="center"><img src="frontend/public/logo.svg" alt="LobakAI" width="320" /></p>

# LobakAI

[![npm](https://img.shields.io/npm/v/@ciwergrp/routerlm.svg)](https://www.npmjs.com/package/@ciwergrp/routerlm)
[![npm downloads](https://img.shields.io/npm/dt/@ciwergrp/routerlm.svg?label=npm%20downloads)](https://www.npmjs.com/package/@ciwergrp/routerlm)
[![GHCR](https://img.shields.io/badge/GHCR-yhagus%2Frouterlm--oss-blue?logo=github)](https://github.com/yhagus/routerlm-oss/pkgs/container/routerlm-oss)
[![GHCR downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fyhagus%2Frouterlm-oss%2Fbadges%2Fghcr-downloads.json)](https://github.com/yhagus/routerlm-oss/pkgs/container/routerlm-oss)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

LobakAI is a local AI gateway with a dashboard.

It serves OpenAI-compatible and provider-specific endpoints on top of many AI providers and accounts.

| Part | Stack | Port |
|---|---|---|
| Gateway API | Bun, Hono, SQLite | `20129` |
| Dashboard | Vue, Vite | `20130` |

## Quick start

Pick one way to run LobakAI.

### npm

You need Node.js 18 or later. The package ships Bun.

```bash
npm install -g @ciwergrp/routerlm
rlm
```

The dashboard opens at `http://localhost:20130/dashboard`.

### Docker

```bash
docker run -d --name lobakai \
  -p 20129:20129 -p 20130:20130 \
  -v lobakai-data:/app/data \
  -e JWT_SECRET="replace-this-secret" \
  -e INITIAL_PASSWORD="replace-this-password" \
  ghcr.io/yhagus/routerlm-oss:latest
```

The image supports `linux/amd64` and `linux/arm64`. See [DOCKER.md](DOCKER.md) for Compose and data paths.

### From source

You need Bun 1.3.14 or later.

```bash
bun install
cp backend/.env.example backend/.env   # set JWT_SECRET and INITIAL_PASSWORD
bun run dev:backend                    # terminal 1
bun run dev:frontend                   # terminal 2
```

## Use the gateway

1. Open the dashboard and sign in. The default password is `123456` unless you set `INITIAL_PASSWORD`.
2. Connect a provider on the Providers page.
3. Copy an API key from the dashboard.
4. Point your tool at `http://localhost:20129/v1`. The dashboard port forwards `/v1` too.

Change the password before you expose the server to a network.

## The `rlm` command

| Command | Purpose |
|---|---|
| `rlm` | Start the server and show the interface menu |
| `rlm --port 8080` | Use another dashboard port. Set `BACKEND_PORT` to move the API. |
| `rlm --host 127.0.0.1` | Accept local connections only. The default is `0.0.0.0`. |
| `rlm --no-browser` | Don't open the browser |
| `rlm --log` | Show server logs |
| `rlm --skip-update` | Skip the update check |
| `rlm connect <url>` | Point local CLI tools (Claude Code, Codex, OpenCode, …) at a LobakAI server |
| `rlm show [tool…]` | Print each CLI tool's current base URL, masked key, and models |

`rlm` replaces an instance that is already running. Update with `npm i -g @ciwergrp/routerlm@latest`.

See [cli/README.md](cli/README.md) for every `connect` option.

## Data

| Install | Database |
|---|---|
| npm or source on macOS and Linux | `~/.lobakai/db/data.sqlite` |
| npm or source on Windows | `%APPDATA%/lobakai/db/data.sqlite` |
| Docker | `/app/data/data.sqlite` |

Set `DATA_DIR` to use another folder.

## Coming from 9router

LobakAI is based on [9router](https://github.com/decolua/9router) and stays backward compatible with its database. Reusing an existing 9router database is fine:

- When `~/.lobakai` does not exist, LobakAI uses an existing `~/.9router` folder as is.
- Or import a 9router database once: set `LEGACY_DATABASE_PATH`, then run `bun run --cwd backend import:legacy`. The source database stays unchanged.

> [!WARNING]
> Going back is not supported. LobakAI adds, renames, and removes providers, so its provider list no longer matches 9router's. Loading a LobakAI database or a "Download Backup" file into 9router can leave connections under providers 9router does not know, and those connections can be dropped together with their credentials. Keep a copy of your 9router database before you switch, and do not import a LobakAI backup into 9router.

## Self-hosting from source

```bash
bun run build            # build the dashboard
bun run start:backend    # API on 20129
bun run preview:frontend # dashboard on 20130
```

Use `ecosystem.config.cjs` for PM2, or `docker compose up -d` for Docker.

## Development

| Task | Command |
|---|---|
| Type-check | `bun run typecheck` |
| Test | `bun run test` |
| Build the npm package | `bun run build:cli` (output in `cli/dist`) |

## Releases

Push a `v*.*.*` tag to release. The tag sets the version.

| Workflow | Publishes |
|---|---|
| `docker-publish.yml` | `ghcr.io/yhagus/routerlm-oss` with the version, `major.minor`, and `latest` tags |
| `npm-publish.yml` | `@ciwergrp/routerlm` on npm, with provenance |
| `release.yml` | A GitHub release for the tag. Its notes come from that version's section in `CHANGELOG.md`, plus install commands. |

Write the `CHANGELOG.md` section for a version before you push its tag.

`badges.yml` refreshes the GHCR download badge once a day. GitHub has no API for container download counts, so it reads the total from the package page and writes `ghcr-downloads.json` to the `badges` branch.

A tag with a suffix, such as `v1.3.0-beta.1`, publishes to the npm `next` dist-tag. `latest` stays on the last stable release.

The npm workflow reads a token from the `NPM_TOKEN` repository secret. The token needs read and write access to the `@ciwergrp` scope and must bypass 2FA.

## Documentation

User documentation sources live in `gitbook/content/en/`. See [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

MIT. The `rlm` launcher and the `connect` and `show` commands are ported from [9router](https://github.com/decolua/9router).
