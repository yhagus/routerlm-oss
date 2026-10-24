<p align="center"><img src="frontend/public/logo.svg" alt="LobakAI" width="320" /></p>

# LobakAI

[![npm](https://img.shields.io/npm/v/@ciwergrp/routerlm.svg)](https://www.npmjs.com/package/@ciwergrp/routerlm)
[![GHCR](https://img.shields.io/badge/GHCR-yhagus%2Frouterlm--oss-blue?logo=github)](https://github.com/yhagus/routerlm-oss/pkgs/container/routerlm-oss)
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
routerlm
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

## The `routerlm` command

| Command | Purpose |
|---|---|
| `routerlm` | Start the server and show the interface menu |
| `routerlm --port 8080` | Use another dashboard port. Set `BACKEND_PORT` to move the API. |
| `routerlm --host 127.0.0.1` | Accept local connections only. The default is `0.0.0.0`. |
| `routerlm --no-browser` | Don't open the browser |
| `routerlm --log` | Show server logs |
| `routerlm --skip-update` | Skip the update check |
| `routerlm connect <url>` | Point local CLI tools (Claude Code, Codex, OpenCode, …) at a LobakAI server |
| `routerlm show [tool…]` | Print each CLI tool's current base URL, masked key, and models |

`routerlm` replaces an instance that is already running. Update with `npm i -g @ciwergrp/routerlm@latest`.

See [cli/README.md](cli/README.md) for every `connect` option.

## Data

| Install | Database |
|---|---|
| npm or source on macOS and Linux | `~/.lobakai/db/data.sqlite` |
| npm or source on Windows | `%APPDATA%/lobakai/db/data.sqlite` |
| Docker | `/app/data/data.sqlite` |

An existing `~/.9router` folder keeps working when `~/.lobakai` does not exist. Set `DATA_DIR` to use another folder.

The backend can import a legacy SQLite database once. Set `LEGACY_DATABASE_PATH`, then run `bun run --cwd backend import:legacy`. The source database stays unchanged.

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

A tag with a suffix, such as `v1.3.0-beta.1`, publishes to the npm `next` dist-tag. `latest` stays on the last stable release.

The npm workflow reads a token from the `NPM_TOKEN` repository secret. The token needs read and write access to the `@ciwergrp` scope and must bypass 2FA.

## Documentation

User documentation sources live in `gitbook/content/en/`. See [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

MIT. The `routerlm` launcher and the `connect` and `show` commands are ported from [9router](https://github.com/decolua/9router).
