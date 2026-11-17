# v3.1.0 (2026-11-17)

## Upgrade

- Run `docker compose pull`, then `docker compose up -d`. The `migrate` service applies one new migration.
- Nothing is breaking. The migration raises an Upstream Model's context size or max output only where it still holds the old Catalog value, so a value you edited is kept.

## Providers

- The Catalog now gives each Upstream Model the most context and output its Provider accepts, not a default. Where a Provider's docs are silent, the figures are models.dev's.
- Kimi K3, K3.1 Pro and K3.1 Pro Highspeed (Moonshot and Kimi Code) can output up to 1,048,576 tokens, up from 131,072, which is only Moonshot's default. On Kimi Code, K3 and K3.1 Pro have a 1,048,576 context, which Pro plans and higher get; on a lower plan, lower the context size of those two models. K3 256K can output up to 262,144.
- OpenAI Codex models take the `max_context_window` of the Codex CLI's model list, 872,000 for eight of them, up from the CLI's default 272,000. GPT-5.5 stays at 272,000.
- DeepSeek models have a 1,048,576 context and a 393,216 max output.
- MiniMax M3 and M3.1 Flash on the M Plan have a 1,000,000 context, up from 524,288. GLM-5.2 on Alibaba has 1,048,576.

# v3.0.0-rc.1 (2026-11-17)

## Upgrade

- **Install from published images.** RouterLM now ships as the images `ghcr.io/yhagus/routerlm-backend` and `ghcr.io/yhagus/routerlm-web` (amd64 and arm64), with a `compose.yaml` attached to each GitHub Release. Installing no longer needs a clone. See ADR 0018 and the README's Quick start.
- **Moving an install made from a clone** keeps its data: `compose.yaml` uses the same project name (`routerlm-oss`) and volume names. In the clone's folder, run `docker compose down`, download the release's `compose.yaml`, add `POSTGRES_PASSWORD` to `.env` (`routerlm` unless you set another one when the database was created), then `docker compose -f compose.yaml up -d`. Keep the same `ENCRYPTION_KEY`. If the folder is not named `routerlm-oss`, also set `COMPOSE_PROJECT_NAME` to its name.
- **Breaking:** `POSTGRES_PASSWORD` has no default in `compose.yaml`; the stack does not start without it.
- **Breaking:** the `ERROR_CAPTURE_RETENTION_DAYS` environment variable is removed. An instance that set it falls back to 7 days until a User changes the Retention Period in the dashboard.

## Dashboard

- The Retention Period of Error Captures is now a Setting you change from the dashboard, from 1 to 365 days. It is 7 days until you change it, and a change applies at the next hourly run without a restart. See ADR 0017.

# v2.1.0 (2026-11-17)

RouterLM 2.1 adds OpenAI Codex as a Provider, Service Tiers, and Indonesian client docs.

## Upgrade

- Run `git pull`, then `docker compose up -d`. The `migrate` service applies seven new migrations and adds the new Catalog rows on start.
- Nothing is breaking. Existing Providers, Models and API Keys keep working.

## Gateway

- A Route can now send to an upstream that uses the OpenAI Responses protocol.
- Service Tiers: a client or a Parameter Policy can ask for the `fast` or `flex` tier. Only OpenAI and OpenAI Codex have Service Tiers, and each maps the tier to its own value. Other Providers ignore the tier. A Parameter Policy can force a tier or forbid one. If the Route's upstream model does not accept the tier, the gateway drops the tier for that Attempt and sends the request anyway. See ADR 0014.
- The Usage Log records the tier that served each request. Cost uses that tier's price when the upstream model has one.

## Providers

- The Catalog adds OpenAI Codex. It accepts only an OAuth login: the operator signs in with a ChatGPT plan through the Codex CLI's device-code flow. See ADR 0013 for the risks.
- OpenAI Codex accounts show a quota meter, with the account's email and plan. A used-up plan is marked exhausted and skipped until its quota resets.
- A Provider states which credential kinds it accepts. You cannot add an API key to OpenAI Codex.
- The OpenAI Provider now has the `fast` and `flex` Service Tiers.
- Every upstream model has a display name.

## Dashboard

- The provider form has a logo picker and the advanced fields.
- The OAuth login settings can be edited for each flow, and the dashboard can sign in to OpenAI Codex.
- Parameter Policies and upstream models can set Service Tiers. Usage shows the served tier and can filter by it.
- The upstream models list groups models that share an id across Providers. It shows the name above the id. Click the name to copy the id.
- Recovered Error Captures show as a success, not as an error.
- The last x-axis label on charts no longer overlaps the tick before it.

## Client docs

- `/docs` is now available in English and Indonesian (`/id/docs`). `/doc` redirects to `/docs`.
- The Errors page calls the JSON error shape an "error body" and explains each field. The Indonesian pages use plain wording and shorter titles.

## Repository

- The README has features, a quick start, and light and dark screenshots.
- The repository has an MIT license.
- `bun run db:seed:demo` seeds demo data for taking the screenshots again.

**Full changelog:** https://github.com/yhagus/routerlm-oss/compare/v2.0.0...v2.1.0

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
