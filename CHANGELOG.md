# v2.0.0 (2026-11-16)

RouterLM 2 is a rewrite. The backend is NestJS on Bun with PostgreSQL and Redis. The dashboard is a Nuxt app. The v1 app lives in `legacy/` and its history is in `legacy/CHANGELOG.md`.

## Breaking changes

- v2 needs PostgreSQL and Redis. `docker compose up -d` starts both, with the backend, the worker and the dashboard.
- v2 does not import v1 data. Add Providers, Provider Accounts, Models and API Keys again.
- Set `ENCRYPTION_KEY` before the first start (`openssl rand -base64 32`). Provider Account keys are encrypted with it. Losing it makes them unreadable.
- This release has no npm package and no container image. `@ciwergrp/routerlm` and `ghcr.io/yhagus/routerlm-oss` stay at 1.6.5.

## Gateway

- Clients can call `/v1/chat/completions`, `/v1/messages` and `/v1/responses`. Every request is converted to one internal format and sent to an OpenAI Chat or Anthropic Messages upstream.
- A Model has ordered Routes. If a Route fails, Fallback tries the next one. A failing Provider Account goes into Cooldown. When every account is in Cooldown or exhausted, the gateway answers 429.
- Each Route can override the timeout and the parameter policy of its Model.
- Automatic cache breakpoints and a prompt cache key can be switched on per Model.
- The gateway never stores prompt or response content.

## Providers

- The Catalog ships Alibaba Model Studio Intl, Anthropic, DeepSeek, Kimi Code, MiniMax API, MiniMax M Plan, Moonshot, OpenAI and Xiaomi MiMo. Upstream models show their release date from models.dev.
- Kimi Code works with an API key or with "Sign in with Kimi". The OAuth login stays valid on its own.
- MiniMax M Plan and Kimi Code accounts show quota meters. An exhausted account is skipped until its quota resets.
- The provider detail page has an Accounts tab and a Models tab.

## Dashboard

- First-run setup creates the first user. Users sign in with a session.
- Overview shows usage charts, with an empty state that walks through setup.
- Usage lists every request with its Attempts, totals, multi-value filters and text search.
- Error Captures keep failed requests and recovered Attempts for 30 days (`ERROR_CAPTURE_RETENTION_DAYS`).
- The Playground sends to a Model or straight to an upstream model.
- API Keys, Users, Models, Usage, Error Captures and upstream models use one data table with search, filters, column picker and paging. Filters, range and page are kept in the URL.
- `/docs` has client documentation with tested examples.

## Run

```bash
git clone https://github.com/yhagus/routerlm-oss.git
cd routerlm-oss
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" > .env
docker compose up -d
```

The dashboard is at http://localhost:3001 and the API at http://localhost:3000.

**Full changelog:** https://github.com/yhagus/routerlm-oss/compare/v1.6.5...v2.0.0
