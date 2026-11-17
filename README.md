<h1 align="center">RouterLM</h1>

<p align="center">
  <strong>One endpoint for every model you pay for.</strong><br />
  A self-hosted AI gateway with fallback across providers, per-request cost tracking and a dashboard to run it all.
</p>

<p align="center">
  <a href="https://github.com/yhagus/routerlm-oss/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/yhagus/routerlm-oss?label=release" /></a>
  <a href="https://github.com/yhagus/routerlm-oss/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yhagus/routerlm-oss/actions/workflows/ci.yml/badge.svg" /></a>
</p>

<p align="center">
  <img alt="RouterLM overview: requests, cost, cache hit rate and error rate over the last 7 days, light theme" src="docs/images/overview.png" width="49%" />
  <img alt="RouterLM overview: requests, cost, cache hit rate and error rate over the last 7 days, dark theme" src="docs/images/overview-dark.png" width="49%" />
</p>

## Why RouterLM

Your tools speak OpenAI or Anthropic. You keep keys at Anthropic, OpenAI, DeepSeek, Moonshot, MiniMax, Alibaba and a couple of coding plans. RouterLM sits between your tools and those providers:

- **One key per app.** Cursor, Claude Code, your CI and your internal tools each get their own `rlm_…` API Key, limited to the Models you allow.
- **Automatic fallback.** A Model is an ordered list of Routes. A rate limit, a 5xx or a timeout moves the request to the next Route, and the failing account rests in Cooldown.
- **Subscription plans, used to the last token.** Kimi Code and MiniMax M Plan accounts show their quota meters. RouterLM skips an exhausted account until its quota resets.
- **Know what every request cost.** RouterLM records tokens, cache reads and writes, latency, time to first token and USD cost for each request. You can view them per key and per Model.
- **Debug failures without logging prompts.** RouterLM never stores prompt or response content. It keeps only failed requests, as Error Captures with credentials redacted, for 7 days by default (`ERROR_CAPTURE_RETENTION_DAYS`).

## Quick start

You need Docker with Compose. No clone: each release publishes the images `ghcr.io/yhagus/routerlm-backend` and `ghcr.io/yhagus/routerlm-web` (amd64 and arm64) and a `compose.yaml` that runs them.

```bash
mkdir routerlm && cd routerlm
curl -LO https://github.com/yhagus/routerlm-oss/releases/latest/download/compose.yaml
curl -L https://github.com/yhagus/routerlm-oss/releases/latest/download/env.example \
  | sed -e "s|^ENCRYPTION_KEY=$|ENCRYPTION_KEY=$(openssl rand -base64 32)|" \
        -e "s|^POSTGRES_PASSWORD=$|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" > .env
docker compose up -d
```

1. Open http://localhost:3001 and create the first user.
2. Under **Providers**, add a key to a Provider.
3. Under **Models**, create a Model and add Routes to it.
4. Under **API Keys**, create a key for your app.

Then point any OpenAI or Anthropic client at the gateway:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $RLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "smart", "messages": [{"role": "user", "content": "Hello"}]}'
```

```bash
# Claude Code
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_AUTH_TOKEN=$RLM_API_KEY
```

The web app serves the full client docs at http://localhost:3001/docs.

> [!IMPORTANT]
> Back up `ENCRYPTION_KEY`. RouterLM encrypts Provider Account keys with it (AES-256-GCM). Without it, nobody can read those keys.

The stack publishes the gateway on port 3000 and the dashboard on 3001, over plain HTTP. Put your own reverse proxy with TLS in front of them, and set `WEB_ORIGIN` to the dashboard's public URL.

## Architecture

```
clients ──► backend (NestJS on Bun, :3000) ──► upstream providers
                │            │
                │            └─► Redis ──► worker (usage, Error Captures, retention)
                ▼
           PostgreSQL ◄── web dashboard (Nuxt, :3001)
```

| Service   | What it does                                                        |
| --------- | ------------------------------------------------------------------- |
| `backend` | Inference endpoints under `/v1` and the dashboard API under `/api`. |
| `worker`  | Writes Usage Logs and Error Captures, deletes expired captures.     |
| `web`     | The dashboard and the client docs.                                  |
| `db`      | PostgreSQL 18, through Drizzle ORM.                                 |
| `redis`   | BullMQ queues between backend and worker.                           |
| `migrate` | One-shot: applies migrations and seeds the Catalog on every `up`.   |

[GLOSSARY.md](GLOSSARY.md) defines the domain terms (Model, Route, Provider Account, Cooldown, Exhausted…). [docs/adr/](docs/adr/) records the design decisions.

## Benchmark

We measured the gateway with [k6](https://k6.io) against a fake upstream, so the results show the cost of RouterLM, not the cost of a Provider. Run the same test with `bun run perf:k6`. [tests/k6/README.md](tests/k6/README.md) describes the setup and the other scenarios.

<img alt="Benchmark: 1,800 virtual users, 444 requests per second, 0 failed requests, and CPU use per node" src="docs/images/benchmark.svg" width="100%" />

End-to-end scenario: the fake upstream waits 200 ms, then streams 200 tokens at 100 tokens/s. Each virtual user (VU) sends its next request as soon as the last one ends. The run lasted one minute on a fresh stack.

**Host:** Docker Desktop on macOS, Apple M3 Pro, with 4 CPUs and 7.6 GB of RAM for the Docker VM. **Limits:** Gateway 2 replicas of 1 CPU / 1 GB, Worker 1 CPU / 1 GB, PostgreSQL 1 CPU / 1 GB, Redis 0.5 CPU / 512 MB.

## Configuration

Set these in the `.env` next to `compose.yaml` (see [deploy/.env.example](deploy/.env.example)). Settings a User changes in the dashboard, such as the Error Capture Retention Period, live in the database instead.

| Variable                        | Default                   | Purpose                                                      |
| ------------------------------- | ------------------------- | ------------------------------------------------------------ |
| `ENCRYPTION_KEY`                | required                  | Encrypts Provider Account keys. 32 bytes, base64.            |
| `POSTGRES_PASSWORD`             | required                  | Postgres uses it only when it first creates the db volume.   |
| `ROUTERLM_VERSION`              | the release's version     | The image version to run.                                    |
| `WEB_ORIGIN`                    | `http://localhost:3001`   | The dashboard's public URL.                                  |
| `NUXT_PUBLIC_GATEWAY_URL`       | browser host, port `3000` | Gateway base URL shown in the `/docs` examples.              |
| `BACKEND_PORT` / `WEB_PORT`     | `3000` / `3001`           | Host ports.                                                  |
| `POSTGRES_USER` / `POSTGRES_DB` | `routerlm`                | Postgres uses them only when it first creates the db volume. |

## Development

The development stack in `docker-compose.yml` builds from the source and reloads on change:

```bash
git clone https://github.com/yhagus/routerlm-oss.git
cd routerlm-oss
sed "s|^ENCRYPTION_KEY=$|ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env.example > .env
docker compose up -d
```

It takes its project name from the folder. For a default clone, that name is `routerlm-oss`, the same name that `deploy/compose.yaml` uses. In that folder, the two stacks share containers and data.

To try the production images on a development machine, build them and run `scripts/smoke-production.sh`. The script uses its own project name and throwaway volumes:

```bash
docker build --target production -t ghcr.io/yhagus/routerlm-backend:local .
docker build --target production -t ghcr.io/yhagus/routerlm-web:local web
ROUTERLM_VERSION=local scripts/smoke-production.sh
```

[AGENTS.md](AGENTS.md) lists the checks, the test setup and the project conventions.

## License

[Apache License 2.0](LICENSE). Third-party attributions are in [NOTICE](NOTICE).
