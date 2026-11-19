# v4.0.0 (2026-11-19)

## Upgrade

- Run `docker compose pull`, then `docker compose up -d`. The `migrate` service applies six new migrations. They turn each Provider's Protocol and base URL into its chat endpoint, give Models and Upstream Models a Kind, add Alibaba Model Studio's image, speech, transcription and video endpoints, and add API Key encryption and rotation history.
- **Breaking:** the dashboard API describes a Provider by `endpoints`, a list with at most one `{ kind, protocol, baseUrl }` per Model Kind, instead of one `protocol` and `baseUrl`. Scripts that create or edit Providers through `/api/providers` must send `endpoints`. Catalog files use the same shape.
- **Behaviour change:** new API Keys are stored encrypted with `ENCRYPTION_KEY`, as well as hashed, so the dashboard can copy them again (ADR 0029). Keys created before this release can't be copied until they are rotated. Revoking a key drops its encrypted copy.

## Image, speech, transcription and video models

- A Model and an Upstream Model have a Kind: chat, image, speech, transcription or video. Media Kinds are priced per unit (per image, per 1M characters, per audio second, per second of video) instead of per token.
- New endpoints, served through Alibaba Model Studio's DashScope Protocols: `/v1/images/generations` and `/v1/images/edits`, `/v1/audio/speech`, `/v1/audio/transcriptions`, and `/v1/videos` to submit a job, poll it and download the result. A video id is an encrypted handle to the upstream task, so any instance can answer a poll (ADR 0027), and media bytes are relayed rather than handing out upstream URLs (ADR 0028).
- A Parameter Policy can force the watermark on media requests.
- The Playground generates and edits images, synthesizes speech, transcribes audio and runs video jobs.
- Error Captures replace media bytes with placeholders.

## API Keys

- Each key's "…" menu copies the full key, edits its name, expiry and allowed Models, rotates it and revokes it. Rotating keeps the key's settings and usage history and refuses the old key at once.
- A Last rotated column opens each key's rotation history: when, by whom, and which key replaced which.
- Allowed Models is picked from a menu, and the form says plainly when a key allows every Model, including ones added later.

## Providers

- A Provider has one endpoint per Model Kind, each with its own Protocol and base URL, all served by the same Provider Account (ADR 0026).
- New Upstream Models: Gemini 4 Neon; GPT-6.2 Sol and Astra on OpenAI Codex; Qwen Image and Wan 2.7 image models, Wan 3.0 Video and HappyHorse 1.1 (text, image and reference to video), Qwen Audio 3.0 TTS Plus and Qwen Audio 3.0 ASR Flash on Alibaba Model Studio.

## Dashboard

- The Providers list and a Provider's page show its endpoints on one line, as an icon per Model Kind with the Protocol in a tooltip.
- Upstream Models show one Price column for every Kind: the amount over its unit, with every price line, such as cache or per-resolution prices, on hover.
- The endpoint fields in the Provider form no longer overlap, and stack on narrow screens.

## Other

- An Upstream Model's Kind can't change while Routes use it.
- A video download that fails to start answers 502.
- Images up to 1536×1536 are priced at the 1K tier.

# v3.3.0 (2026-11-18)

## Upgrade

- Run `docker compose pull`, then `docker compose up -d`. The `migrate` service applies three new migrations. One merges duplicate Provider Accounts that a single OAuth sign-in created, moving their usage history onto the account it keeps.
- **Behaviour change:** Provider URLs (`baseUrl`, `quotaBaseUrl` and the OAuth login hosts and issuer) must now be https and must not point at localhost, loopback, private or link-local addresses, in Catalog files and in the dashboard. Self-hosters with a LAN upstream, such as Ollama or vLLM, must set `ALLOW_PRIVATE_UPSTREAMS=true` in `.env`. A stored URL that no longer passes is not rewritten, and the gateway refuses to connect to it.
- **Behaviour change:** an upstream 403 now starts a Cooldown instead of disabling the Provider Account. The third 403 in a row, with no successful request between, disables it. A 401 still disables it at once.
- Behind a reverse proxy, set `TRUST_PROXY` (to `true`, or to the proxy's address or subnet). It is off by default, so a forged `X-Forwarded-For` is ignored. Without it, every client appears as the proxy's IP.
- To use more than one CPU, set `BACKEND_PROCESSES` in `.env` to the VM's CPU count. It defaults to 1, as before. It works on Linux hosts only; elsewhere the backend logs a warning and runs one process.

## Performance

- The backend can run several gateway processes on one port (`BACKEND_PROCESSES`). Before, it used one CPU however large the VM was.
- Streams pass through one relay loop instead of eight stages per token, and common stream chunks skip full schema validation.
- Each request waits on Redis less: Cooldown state comes from a per-process copy at most one second old.
- On the k6 benchmark (2 CPUs for the gateway, 1,800 virtual users, a 2.2 s upstream answer), throughput rose from 444 to 644 requests per second and the median latency fell from 3.31 s to 2.37 s. The gateway alone handled 4,825 requests per second, up from 2,081.

## Security

- Every backend instance reloads its snapshot from the database every 30 seconds (`SNAPSHOT_RELOAD_INTERVAL_MS`), and retries a failed reload after a change. A revoked API Key or a disabled Provider now stops working on every instance within that interval, even when the change notice was lost or Redis was down.
- `POST /api/auth/login` allows 10 attempts a minute per client IP and answers 429 beyond that. The count is shared across instances through Redis, and login stays open if Redis is down.
- The gateway does not rate limit `/v1`. Do that in your reverse proxy.
- Login caps the length of the email and password it accepts.
- A failing database health check answers 503 without the database's error text.
- Requests to models.dev no longer follow redirects.

## Providers

- New Providers: Xiaomi MiMo Token Plan (MiMo-V2.6-Pro, MiMo-V2.6-Flash) and Meta AI (Muse Ember 1.0, Muse Wonder 1.0, Muse Spark 1.3, 1.2 and 1.1). Both carry a Terms Risk flag, so they serve requests only while the "Allow terms-risk providers" Setting is on.

## Dashboard

- The Parameter Policy has a thinking budget Cap, which bounds Anthropic `thinking.budget_tokens`. A Cap never fills in a value the client omitted, and the dashboard points out a Cap that has no default.
- Usage Logs keep the names they showed when the request was made. Renaming or deleting a Model, Provider, Provider Account or API Key no longer changes or blanks old rows. A Playground row shows "deleted user" once its User is gone.

## Other

- One OAuth sign-in creates exactly one Provider Account, even when its result is polled twice.
- On SIGTERM the backend now shuts down cleanly instead of stopping at once.
- A stream the gateway cannot translate for the client, such as tool call arguments that arrive interleaved, ends with the client Protocol's error event.
- A usage job that fails for good is removed from Redis.

# v3.2.0 (2026-11-18)

## Upgrade

- Run `docker compose pull`, then `docker compose up -d`. The `migrate` service applies two new migrations.
- **Behaviour change:** Kimi Code, MiniMax M Plan and OpenAI Codex now carry a Terms Risk flag, because their plans may not allow the gateway's use. While the new "Allow terms-risk providers" Setting is off, which is the default, these Providers serve no inference and are not listed to clients. An instance that uses one of them must turn the Setting on in the dashboard Settings page. Each Provider's own enabled flag is untouched.

## Providers

- New Provider: Google Gemini, through its OpenAI-compatible endpoint, with Gemini 4 Hydrogen, Carbon and Argon, Gemini 3.8 Flash, 3.7 Flash and 3.5 Flash Lite.
- New Providers: Command Code and OpenCode Go. OpenCode Go forwards the client's user agent and session to its upstream.
- OpenAI gains GPT-6.2 Astra and GPT-6.2 Sol, with the Fast service tier.

## Dashboard

- A Provider that speaks the OpenAI chat Protocol has a "Forwarded client headers" field, for request headers passed on to the Provider, such as `user-agent`.
- The first page you open in a browser session shows a notice when models.dev lists one of the 5 newest models of your Providers that your Catalog does not hold yet. It only reports; it adds nothing. If models.dev cannot be reached, nothing is shown.

## Other

- The license is now Apache-2.0, up from MIT.

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
