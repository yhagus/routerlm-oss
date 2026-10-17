# Archived v2 Migration Plan

The Version 2 cutover completed on 2026-08-27.

This file records migration decisions and parity evidence.

The current runtime layout is documented in `docs/ARCHITECTURE.md`.

## Historical status

This section records the status before the completed cutover.

> **Session handoff:** the backend port is code-complete (management routes, full chatCore mutator pipeline, all 27 specialized executors, media backends with v1 combo/fallback semantics, host operations incl. watchdog/auto-start, v1 auth layering; 102/102 tests green; first live differential run done). Remaining backend work is small and listed below; the next major phase is the frontend (Milestones 8/9).

### Implementation Log

- Milestone 0 foundation: `v2/parity-manifest.generated.json` is generated from all 187 legacy API route files by `bun run --cwd v2 parity:manifest`. Routes remain `needs-review` until differential coverage assigns their final classification.
- Milestone 1 foundation: read-only HTTP comparison, root database hashing, and disposable SQLite clone preparation are available through `parity:diff`, `parity:hash-root-db`, and `parity:prepare-databases`.
- Milestone 2 slice: the frontend now unwraps the implemented management envelopes, uses the correct custom-model and alias request contracts, and exposes proxy-pool testing.
- Milestone 3 slice: public model lists now include configured provider models and aliases, honor model access rules, and are available at the root `/v1` list alias.
- Milestone 3/4 slice: `ollama-local` now has a dedicated v2 execution path with its v1 default host behavior, `/api/tags` model discovery, OpenAI request translation, native NDJSON handling, OpenAI SSE conversion, tool calls, thinking deltas, usage, and fallback-state persistence.
- Milestone 5 slice: combo account filters and custom account order now constrain v2 gateway account selection instead of being dashboard-only metadata.
- Milestone 7 slice: the provider-detail OAuth modal now drives the existing authorization-code and device-code endpoints and persists a connection only after successful exchange or poll. Native auth remains explicitly unavailable until its backend flow exists.
- Milestone 7 slice: generic OAuth now applies the v1 provider-specific PKCE/device-code rules for Kiro, Qoder, Kimi, GitHub, Grok CLI, CodeBuddy, Cline, Trae, and Windsurf, and persists normalized expiry, scope, token type, and refresh metadata.
- Milestone 7 slice: special provider auth/import surfaces now cover Codex, Cursor, GitLab, iFlow, Kiro, Qoder, Grok CLI, and xAI through dedicated v2 handlers and provider-detail forms. Secure local auto-import persists credentials without returning them.
- Milestone 7 slice: dashboard OIDC now uses discovery, PKCE, state/nonce cookies, authorization-code exchange, and remote-JWKS signed ID-token verification. It does not trust an unverified identity token.
- Milestone 7 slice: Codex, xAI, Trae, and Windsurf now have runtime-owned loopback callback-proxy lifecycle support: start, session registration, safe polling, manual xAI code entry, stop, timeout cleanup, and runtime shutdown cleanup. Trae/Windsurf IDE status is included.
- Milestone 7 slice: Cursor and Kiro host-local auto-import now follows the v1 local path/cache discovery model, is loopback-only, persists credentials without returning them, and redacts discovery output.
- Milestone 7 slice: Zed native authentication now has its own v2 callback/session/organization flow and live model discovery. Its specialized completion executor remains a gateway-execution task, not an authentication gap.
- Milestone 8 slice: Account Groups, Pricing Settings, combo-account compatibility, and media-combo compatibility routes are registered and discoverable from navigation where applicable.
- Milestone 2/8 backend slice: the remaining v1 management-route inventory is registered in v2 with contract tests — provider `:id/settings` (zed-only contract incl. 400/404 semantics), `:id/test-models` (warm-up, grok-cli sequential throttle, live compatible discovery), `/api/providers/client` (usage-eligible filtering, name masking, codex email backfill from id_token, pagination/sorting), `kilo/free-models` (1h cache + stale-on-error), `/api/models/availability` (modelLock_ cooldowns + clearCooldown reset) and `/api/models/test` (llm/embedding/image/stt probe classification via the gateway), `/api/usage/stats` period filtering, `/api/usage/request-logs` (v1 pipe-separated rendering), `/api/usage/stream` (SSE live stats with pending/error wiring in the gateway), codex reset-credits GET/POST (refresh-first, auth-expired retry, no-credit 409), `/api/client/usage` + `/api/client/free-tracker` (client-session auth, combo account mapping, public-only sources), `/api/connect` + `/api/connect/usage` (default public key discovery, 60s stale-while-revalidate per-combo model usage), media-provider voice catalogs (generic edge-tts/local-device/elevenlabs/gemini + elevenlabs/deepgram/inworld/minimax grouped endpoints) with `/v1/audio/voices` speech-ready listing, proxy-pool cloudflare/vercel/deno relay deploys, `/api/dashboard/chat/*` playground (models, accounts, completions via gateway, sandbox/skill tools), and `/api/version` + update/shutdown + dev `/api/shutdown` with v1's always-protected gating. Two latent v2 bugs fixed en route: `providers.update` let stale aliased credentials clobber explicit data patches, and `/api/usage/:connectionId` shadowed the statically-registered `qoder-inject-logs` route.
- Milestone 6 slice: the media/search/fetch backends now execute through the real provider adapters instead of the generic chat forwarder. `/v1/search` reuses the v1 search dispatcher (10 dedicated search APIs + chat-based search with the v1 normalized result envelope), `/v1/web/fetch` reuses the v1 fetch core behind the SSRF guard (firecrawl/jina/tavily/exa), `/v1/embeddings` runs a thin v2 core over the v1 embedding adapters (OpenAI-compatible factory, gemini, compatible/custom-embedding nodes) with 401/403 refresh-retry, `/v1/audio/speech` ports the v1 TTS core (special adapters for google-tts/edge-tts/local-device/elevenlabs/openai/openrouter/gemini plus registry-driven config synthesis for the generic formats), `/v1/audio/transcriptions` forwards real multipart through the v1 STT core (whisper/deepgram/assemblyai/gemini protocols), `/v1/images/generations` runs a thin v2 core over the v1 image adapters (OpenAI-shaped JSON plus `response_format=binary` decoding; the antigravity executor-delegated adapter is explicitly gated until the executor phase), and `/v1/videos/{generations,edits,extensions,:id}` is a byte-preserving proxy with billable-job-safe error handling and account pinning via `x-lobakai-connection-id`/`x-connection-id`. A shared media layer provides v1-parity model resolution (alias → combo → node prefix → registry alias → prefix inference with OpenAI default), the v1 credential shape for adapters, the uniform account-fallback loop with per-model cooldown locks, API-key model access/limit gating, and usage recording. Known follow-ups: media combo expansion is sequential-fallback only (full strategies are Milestone 5) and the fallback-eligibility rule is status-code-based (v1's provider-specific message heuristics land with Milestone 5).
- Milestone 10 slice: host operations are real. Tunnels run the actual v1 pipeline — cloudflared is downloaded/validated/spawned as a quick tunnel with URL parsing, worker registration, reuse-if-healthy, and v1's 8s DNS-warmup response delay; Tailscale flows (daemon start with sudo, login-check with authUrl passthrough, funnel start/reset, cert provisioning, SSE installer with brew/curl/msi paths) are ported on v2 settings. PXPIPE runs the v1 library-mode runtime (npm install into DATA_DIR, in-process transform module load/unload, PRD health checklist, JSONL event stats, install log). Headroom uses the v1 detect/process modules (binary/python discovery, detached proxy spawn/stop with SIGTERM→SIGKILL, pip extras install/remove, loopback-only start guard) plus a byte-preserving reverse proxy with dashboard HTML rewriting. The MITM subsystem mounts the v1 CJS manager with `initDbHooks` pointed at the v2 settings repo — real status/start/stop/patch (per-tool DNS, cert trust, PORT_443_BUSY conflicts) and alias routes backed by the v2 `mitmAlias` kv scope plus the standalone-server `aliases.json` replica. CLI-tools writers were already real from the earlier phase (verified by existing parity tests). Cloud sync is a documented exclusion: v1 contains no sync routes, no scheduler, and no cloud HTTP calls — only dead settings flags. Known follow-ups: tunnel/MITM watchdog auto-restart monitoring, MITM boot auto-start when `mitmEnabled`, and wiring the PXPIPE transform into the chat execution pipeline (`getTransform`/`appendPxpipeEvent` hooks). A new execution layer (`services/execution/`) registers 24 pure v1 executor classes (codex, kiro, cursor, gemini-cli, github, windsurf, trae, iflow, qwen, vertex, antigravity, grok-cli, zed, kimchi, codebuddy, opencode, xiaomi-tokenplan, grok-web, perplexity-web, mimo-free, commandcode, opencode-go, grok-video, azure) with their provider aliases; cursor-api/devin-cli (CLI spawns) and ollama-local (dedicated v2 path) are explicitly gated. Requests flow through the v1 translator registry (source detection incl. endpoint quirks, model-level target formats, upstream id mapping) and responses translate back per SSE chunk with proper OpenAI/Claude/Responses wire formats, forced-stream buffering for non-stream clients, and usage recording. Resilience now follows v1 semantics: `checkFallbackError` message+status classification with exponential backoff and `resets_at` honoring, per-model `modelLock_` cooldowns, provider/account strategies (fill-first, sticky round-robin with `consecutiveUseCount`), noAuth synthetic connections, provider-specific 401/403 refresh-retry via each executor's own `refreshCredentials`, and combo dispatch through v1 `handleComboChat` (fallback + round-robin/sticky strategies, transient cooldown waits). Chat routes try the executor path first and fall back to the generic gateway path for unregistered providers. Tests introduced a preload fetch harness because the v1 proxy layer captures `globalThis.fetch` at import time. Known follow-ups: cursor-api/devin-cli host bridges, v1 chatCore body mutators (RTK token savers, headroom, caveman/ponytail, pxpipe, combo identity, requestDetails capture), and outbound proxy support (Bun fetch ignores undici dispatchers).
- Milestone 4/5 slice: the qoder executor is registered in v2. v1's `open-sse/executors/qoder.js` now takes an injectable context-window resolver (`setQoderModelContextWindowResolver`) whose default lazily dynamic-imports the same `@/lib/modelContextWindowsDb` shim, so v1 behavior is unchanged while v2 supplies a resolver over its own `modelContextWindows` kv scope (same `provider/model` key shape and normalization). v2 registers the executor with its COSY/PAT wire protocol intact (encoded bodies, SSE `body`-envelope unwrapping, first-event error inspection, forceStream buffering, PAT exchange at execute and refresh time). En route, the execution layer's persistence was aligned with v1 semantics: `markAccountUnavailable` writes the v1 sparse patch (`modelLock_*` + `testStatus: "unavailable"` + `lastError` ≤100 chars + `errorCode` + backoff, no `rateLimitedUntil`; `disableAccount` → `isActive: false`; non-fallback errors no longer lock accounts), `clearAccountError` became the v1 sparse/conditional patch (`testStatus: "active"` only when no active locks remain, succeeded+expired locks nulled, token fields untouched), and refresh persistence now honors `expiresAt`/`providerSpecificData` and marks the account active — fixing three latent bugs: a stale-snapshot clear that clobbered refreshed tokens, refresh persistence dropping provider-specific extras, and the qoder 403 quota path never disabling accounts. Covered by `tests/qoderExecutor.test.ts` (streaming, buffering, kv context-window override via a test-side body decoder, envelope-error failover, 403 disable, PAT exchange, 401 refresh+persist); v1's 54 qoder unit tests still pass.

- Backend completion slice: every remaining execution-layer, media, and host-op gap is code-ported. chatCore body mutators now run in v1 order (bypass patterns before combo rotation, combo identity + provider thinking pre-translation; RTK → headroom → caveman → ponytail → pxpipe token savers on the final body with the `x-lobakai-token-saver` opt-out header), plus client-tool detection with native passthrough + claude normalization, modality strip + remote-image prefetch, `stripList` translation, tool dedupe, grok-cli `prompt_cache_key`/`_compact` handling + compaction responses, the v1 stream decision (forceStream, Accept-header JSON preference, deepseek-tui, imageGen), `refreshWithRetry` with rotating refresh tokens, per-connection proxyOptions passed to executors, and observability-gated `requestDetails` capture (buffered writes, sanitization, truncation, max-records trim) through the ported requestDetail builders. Fusion combos dispatch through v1 `handleFusionChat` (judge/tuning/panel semantics) and combo dispatch threads identity + custom account order (v1 `sortConnectionsKinds`-style ordering + empty-filter 503). Outbound proxies work under Bun: v1 `proxyFetch` uses Bun's native `proxy` init option when running on Bun (Node keeps undici dispatchers), and v2 applies the global outbound proxy env at boot and on settings PATCH exactly like v1's `initOutboundProxy`. `cursor-api` and `devin-cli` executors are registered (27 total; only ollama-local stays intentionally gated). grok-cli free-usage exhaustion is fully ported (credits probe for precise resets, providerSpecificData markers, selection-time skip, marker cleanup on success). Media: the antigravity image adapter executes through the registered executor (501 gate removed), media combos dispatch through `handleComboChat` strategies instead of sequential fallback, and the media account loop uses the shared v1 mark/clear semantics (checkFallbackError classification, modelLock skip, grok-cli markers) instead of the status-code set. The Gemini `/v1beta` route is a full port (executor dispatch, OpenAI→Gemini SSE transform without [DONE], non-stream conversion, gemini-native TTS forwarding with account fallback, 403 model listing), `/v1/models/*` deep paths 404 like Next, and the generic gateway resolves bare model ids via v1 prefix inference. Auth matches v1's layering: dashboardGuard-style middleware (local/CLI-token/valid-key) with route-level `requireApiKey` on chat/media/gemini using v1's exact error envelopes, and the admin 401 is the bare `{"error":"Unauthorized"}`. Host ops: `initializeApp` port covers boot auto-resume (tunnel/tailscale/MITM with saved-password guard + DNS restore), the 60s watchdog, and the network monitor (IPv4 fingerprint + sleep/wake + online-edge). Combos now default `kind` to null like v1, `comboMatchesKinds` gates combo visibility per kind, and the `chat` kind slug was removed from `/v1/models/:kind`. First live differential run completed (read-only, disposable v2 instance seeded from a v1 DB clone; root DB hash verified unchanged): 12/30 fixtures pass; all auth/validation/error-contract routes pass; remaining diffs are model-list body contents (running v1 is a stale Aug-6 build — current v1 code changed the list logic in c0ef256c), Next's text/html 404 for deep `/v1/models/*` paths, and two stale-build artifacts (`/v1beta/models` 200-vs-403, `/api/connect` 401-vs-public) where v2 matches current v1 code. Known follow-ups: grok-cli availability probe + quota auto-ping schedulers need v2-native ports (they import the legacy localDb), and the model-list bodies need a re-diff against a current v1 build.

### Frontend continuation slice (2026-08-16)

- Provider detail now owns v1's core connection/model operations: browser-safe thinking levels, cooldown/status diagnostics, grouped accounts, edit/delete/toggle/test flows, proxy assignment and bulk rotation, aliases, model tests, disabled-model restore, Qoder/Cursor fetches, Kilo suggestions, Zed organizations/System ID, and Qoder context-window overrides.
- The v2-only `/dashboard/models` and `/dashboard/provider-nodes` destinations were removed after those controls moved into provider detail. Compatible-node CRUD remains available through provider detail and `/dashboard/providers/new`.
- Host-operation UI gates were removed for Endpoint tunnels, MITM, Headroom, PXPIPE, and CLI local-file apply; controls now call the implemented v2 routes and surface runtime/install/permission errors.
- Missing public/client surfaces were added: `/login/guest`, `/callback`, `/connect`, `/client`, and `/client/qoder-injector`, using the existing v2 auth, connect, client-portal, and Qoder job contracts.

### Provider-detail parity slice (2026-08-17)

- The provider detail page was rebuilt to match v1 (`src/app/(dashboard)/dashboard/providers/[id]`) in structure and design language: Material-Symbols header with Get API Key / Sign up link, deprecated Risk-Notice and info banners, compatible-node card with the API path line, Zed System ID card (inline input + applied-count message), Connections card with v1's toolbar (Apply Proxy / Delete Selected / one-by-one test with the Total/Completed/Passed/Failed/Stopped summary bar / Round Robin + sticky), folder group headers ("Ungrouped" last) with checkboxes, v1 ConnectionRow (priority arrows, auth icon, status/auth/group/Proxy badges, CooldownTimer, masked proxy URL + no_proxy, Proxy/Auto-ping/Test/Edit/Delete icon buttons, Toggle switcher), and the add-connection row (dual-auth labels, iflow Cookie, Bulk Add for codex/qoder/xai/grok-cli, grok-cli Export). Models card: thinking select, Disable All/Active All, custom-first ModelRow chips with caps badges and thinking suffixes, AddCustomModelModal, Fetch Qoder/Cursor models, suggested free models for all ten `modelsFetcher` providers, disabled-model restore, QoderModelContextWindows (real caps), and CompatibleModelsSection for compatible nodes. `lib/providerMeta.ts` (names/aliases/colors/notices/fetchers/regions) is generated from the v1 registry.
- Backend fixes surfaced by the rebuild: `PUT/POST /api/providers` now persist v1's flat patch fields (`group`, `defaultModel`, `testStatus`, `lastError`, `lastErrorAt`, `apiKey`, `providerSpecificData`) into the data bag and validate `proxyPoolId` (400 "Proxy pool not found"), `/api/models` attaches v1 `getCapabilitiesForModel` caps to built-in rows, and `api.providers.test` exposes v1's `valid` field (connection-test consumers were reading a non-existent `ok`, marking every one-by-one test failed). Regression test added in providerExtras.test.ts; 104/104 backend tests, frontend typecheck/tests/build green; browser-verified on the live instance (qoder groups/badges/models/ctx windows, anthropic Get API Key + empty state, claude Risk-Notice banner).

### Add-Connection / OAuth + chat-stream parity slice (2026-08-17)

- Add Connection now runs v1's exact flows: the unified v2 `ProviderAuthModal` (which broke Codex by sending a dashboard redirect URI instead of `localhost:1455/auth/callback`) was replaced by ports of v1's modal set — `ProviderOAuthModal` (device-code auto-polling with per-provider extraData, codex 1455 / xai 56121 server-side callback proxies + poll-status, trae/windsurf dynamic-port proxy + paste-token + ide-status, popup postMessage/BroadcastChannel/localStorage callback relay, manual paste with raw-JWT/xai-code/kimchi handling), `KiroOAuthWrapper`/`KiroAuthModal` (Builder ID, IDC start-URL form, API key, refresh-token and CLIProxyAPI-JSON imports), `CursorAuthModal` (IDE SQLite auto-import + manual), `GitLabAuthModal` (OAuth App PKCE meta or PAT), `IFlowCookieModal`, and `NativeAuthModal` (Zed loopback). `providerAuthModes` became registry-driven via the regenerated providerMeta (which now also merges the registry's top-level authModes, e.g. kimchi's paste-token OAuth).
- Backend: `/api/oauth/:provider/exchange` regained v1's raw-JWT path (pasted `eyJ…` Codex/ChatGPT token → `access_token` connection with account claims); `stop-proxy` corrected to GET. Chat: non-streaming requests to Gemini-family executors returned raw `{"candidates":…}` JSON — added `fromGeminiShape` so `normalizeToJsonOpenai` converts to OpenAI completions (verified live). Streaming verified live (SSE deltas + usage incl. reasoning tokens). Provider catalog re-verified: 120/120 v1 registry ids in the v2 grid. Live-tested on the dev instance: codex authorize URL (auth.openai.com, localhost:1455 redirect, PKCE) + armed 1455 listener + poll-status; qoder and kiro device-code UIs; iflow cookie modal.

### Quota/design parity slice (2026-08-17)


- Frontend: Quota Tracker, Free Tracker, Token Saver, and CLI Tools now match v1's design and behavior (Material Symbols icon font + `kimchi.svg` asset parity, v1 Toggle switchers, ProviderLimits quota architecture on `/api/providers/client` + `/api/usage/:connectionId`, Headroom setup modal, v1 CLI tool catalog with images). Page-by-page status: `v2/FRONTEND_PARITY.md`.
- Backend fix surfaced by the quota rewrite: `v2/backend/src/services/providerUsage.ts` ports v1's `GET /api/usage/[connectionId]` — the real open-sse usage adapters (`getUsageForProvider`, ~20 provider families incl. gemini-cli/qoder/claude/codex/github/kiro/grok-cli/kimi/glm/minimax/deepseek/codebuddy-cn), executor credential refresh with v1 sparse-patch persistence, auth-expired force-refresh retry, and the grok-cli Daily-Allowance merge (rolling usage computed over v2 `usageHistory` with v1's 24h window). Verified live: gemini-cli renders real quota rows; expired qoder test accounts correctly surface the adapter's 401 message.
- Qoder 401 follow-up fix: seeded/imported v1 rows keep provider extras in a **nested** `providerSpecificData` object inside v2's `data` bag, but the usage route (and the chat credential selector) aliased the whole bag as `providerSpecificData` — hiding `personalAccessToken`/`userId`, so qoder's PAT re-login never ran and quota fetches kept using the expired session token. `resolveV1ProviderSpecificData` (execution/credentials.ts) now picks the nested object when present (bag for flat v2-native rows); usage-route refresh persistence and chat `persistRefresh` merge extras into the nested copy for v1-shaped rows. Regression test in usageExtras.test.ts; verified live — both qoder accounts render full quota tables (Personal + Qwen3.8-Max event rows) with rotated `jt-` tokens persisted.
- The v2-only `/api/quota*` aggregator routes are now unused by the UI and are removal candidates (v1 has no `/api/quota`).

## Objective

Deliver v2 as a standalone Bun/Hono/Vue implementation with verified, externally observable parity with root v1 for the approved product surface.

Parity means:

- Compatible HTTP routes, methods, authentication, status codes, headers, payloads, and streaming behavior.
- Equivalent model/provider resolution, account selection, fallback, refresh, and usage semantics.
- Equivalent persistence behavior against an isolated database copy.
- Equivalent dashboard operations and navigation, not only equivalent visuals.
- No silent feature removals. Every v1 capability is either ported or explicitly approved as excluded.

Root v1 remains the behavioral authority until cutover.

## Safety Rules

- Never write to `~/.lobakai/db/data.sqlite`.
- Never point v2 at the root v1 database.
- Use a resettable v2 database copy for normal testing.
- Use two disposable, equivalent database clones for mutation comparison: one for v1 and one for v2.
- Run read-only comparisons against the live root v1 instance only.
- Normalize generated IDs, timestamps, tokens, hashes, and secret fields before response comparison.
- Keep v2 standalone. Do not import the legacy Next.js runtime or `open-sse` runtime into v2. <br/>- v2 reuses v1 code only through the frozen vendored snapshot under `v2/backend/src/vendor` (see `v2/backend/src/vendor/README.md`). Re-vending is an explicit, reviewed step; v1 changes never flow in automatically.
- Redact credentials in fixtures, snapshots, logs, and test failures.

## Definition Of Done

The migration is complete only when all of the following are true:

1. The route inventory classifies every v1 route as `parity`, `approved exclusion`, or `internal-only`.
2. Every `parity` route has automated contract coverage.
3. All client-facing compatibility APIs have live v1-v2 differential tests.
4. All mutation paths have disposable v1-v2 database-semantic tests.
5. Provider/model/authentication behavior is verified for every supported provider family.
6. The v2 dashboard exposes and successfully performs each supported v1 management operation.
7. Unsupported host-dependent capabilities are either implemented or explicitly approved as exclusions.
8. Backend and frontend typechecks, tests, builds, and visual checks pass.
9. Root v1 data remains unchanged throughout the migration.

## Baseline

Already implemented or partially implemented:

- Registry-backed provider metadata and static models.
- Primary provider CRUD, settings, keys, models, aliases, combos, proxy pools, usage, and logical database backup/import contracts.
- Primary password/session/API-key paths.
- Generic provider test/discovery, generic OAuth contracts, selected provider imports, generic refresh-on-401, streaming, fallback, and Gemini request routing.
- Isolated v2 database execution on port `20129`.
- Vite/Vue dashboard shell and management views.

Known remaining frontend gaps:

- Provider-detail diagnostics, cooldown presentation, Zed organization controls, model suggestions, and provider-specific settings remain partial.
- Native-provider UI coverage is currently limited to the ported Zed flow.
- Header breadcrumbs, search, language selection, OIDC identity display, and disconnected/update states remain unported.
- Some host-operation views still expose capability-gated rather than operational controls.

## Milestone Status

Legend: `[x]` implemented foundation or feature slice, `[~]` in progress or requires parity verification, `[ ]` not started.

- [~] Milestone 0: all 187 legacy API routes are inventoried; 185 still require classification and ownership review (the `v2Area` mapper in `v2/scripts/buildParityManifest.ts` is stale — 34 routes report no v2 owner although most are implemented).
- [~] Milestone 1: read-only HTTP diff, root DB hashing, and disposable SQLite clones exist; complete route/mutation comparison suites remain.
- [~] Milestone 2: primary management envelopes plus the full remaining management-route inventory (provider extras, model availability/test, usage stream/request-logs/codex-credits, client portal, connect discovery, voice catalogs, proxy deploys, dashboard chat, version/updater/shutdown) are implemented with contract tests; exact route-by-route differential parity remains.
- [~] Milestone 3: configured models, aliases, access filtering, public model aliases, and Ollama discovery are implemented; specialized live resolvers remain.
- [~] Milestone 4: generic execution, the dedicated Ollama path, and 27 specialized v1 executors with translator-registry request/response handling, the full chatCore mutator pipeline, fusion combos, outbound proxy support, and requestDetails capture are implemented; per-family differential verification remains.
- [~] Milestone 5: v1 fallback semantics (checkFallbackError classification, resets_at honoring, modelLock_ cooldowns, grok-cli quota markers/probe, fill-first/sticky-round-robin/custom-order strategies, noAuth synthetic connections, refreshWithRetry) and combo dispatch via v1 handleComboChat + handleFusionChat are implemented; per-family differential verification remains.
- [~] Milestone 6: media/search/fetch/video run through the real v1 provider adapters (search dispatcher, fetch core + SSRF guard, embeddings/images thin cores, TTS core, STT multipart, byte-preserving video proxy with account pinning), media combos use v1 strategies, the media loop uses v1 mark/clear semantics, antigravity images execute through the registered executor, and Gemini-native `/v1beta` is fully ported; differential verification remains.
- [~] Milestone 7: generic OAuth, OIDC, native Zed auth, callback proxies, imports, and local auto-import are implemented; differential provider-flow verification remains.
- [~] Milestone 8: core navigation, account groups, compatibility routes, provider OAuth/import UI, and proxy testing are implemented; provider-detail and dashboard operation parity remain.
- [ ] Milestone 9: global shell, breadcrumbs, search, language, OIDC identity presentation, and visual parity.
- [~] Milestone 10: host operations are real (version/update/shutdown, tunnels, MITM lifecycle, PXPIPE, headroom proxying, cli-tools config writers, boot auto-resume + watchdog + network monitor via initializeApp, PXPIPE transform wired into chat execution); cloud sync is a documented exclusion. Remaining: grok-cli availability probe + quota auto-ping scheduler ports.
- [ ] Milestone 11: complete differential, mutation, browser, visual, integrity, and cutover verification.

## Handoff: Remaining Work

Consolidated backlog for the next session. The backend port is code-complete at 102 tests, all green (`bun run --cwd v2 typecheck:backend && bun run --cwd v2 test:backend`); the first live read-only differential run is done (see the implementation log).

### Backend leftovers (small)

- grok-cli availability probe + quota auto-ping schedulers: v1's modules import the legacy localDb; they need v2-native ports against the v2 repos.
- Model-list body parity: re-run `parity:diff` against a CURRENT v1 build (the live instance was a stale Aug-6 build; v1's list logic changed in c0ef256c). Fixture file: `v2/parity-fixtures.json` (30 routes).
- Next's text/html 404 page for deep `/v1/models/*` paths is an infrastructure artifact, documented as an accepted diff.
- Phase 5 manifest hygiene: fix the stale `v2Area` mapper in `v2/scripts/buildParityManifest.ts`, regenerate the manifest, and move implemented routes out of `needs-review`.

### Frontend (Milestones 8/9) — next major phase

- Full side-by-side route/shell/provider-detail inventory: `v2/FRONTEND_PARITY.md` (REMOVE/PORT/COMPLETE buckets; session checkboxes live there).
- Provider-detail diagnostics, cooldown presentation, Zed organization controls, model suggestions, provider-specific settings remain partial.
- Native-provider UI beyond Zed; header breadcrumbs/search/language/OIDC identity.
- Top-level pages `/login/guest`, `/callback`, `/connect`, `/client`, and `/client/qoder-injector` are ported; browser interaction verification remains.
- Confirmed v2-only surfaces to remove: `/dashboard/api-keys`, `/dashboard/models`, `/dashboard/provider-nodes`, `/dashboard/mcp`, `/dashboard/developer`, `/dashboard/operations/tunnels` (tunnels belong in `/dashboard/endpoint` per v1), v2-only redirect aliases, `music`/`imageToText` media kinds, dead components, "LobakMerah Proxy v2" branding. Model/provider-node routes are now removed.
- Pricing settings: match v1 — orphan route, no navigation entry (owner decision 2026-08-16, overriding the earlier Milestone 8 "make discoverable" note).
- Host-operation gates: MITM/tunnels/PXPIPE/headroom/CLI-apply controls are now wired to live endpoints; browser verification and host permission/error-state checks remain.
- Scope rule from the owner: match v1 exactly — do not add anything v1 does not have; investigate and remove v2-only additions that feel disconnected.

### Milestone 11 — Verification and cutover

- Full differential (live v1 vs v2 on a current build), disposable mutation, provider-family, streaming, browser, and visual suites; then cutover checks.

### Session conventions worth keeping

- Tests run with `bun test --preload ./tests/fetchHarness.ts` (already in `v2/backend/package.json`); the harness exists because v1's proxy layer captures `globalThis.fetch` at import time — use `installFetchMock` from `tests/fetchHarness.ts` for anything exercising executors, plain `globalThis.fetch` swaps for v2-only code.
- bun's `toMatchObject` mutates the received object in place — capture values before asserting.
- v2 remains untracked in git in its entirety; no migration work has been committed yet.
- Differential runs: clone the v1 DB WITH its `-wal`/`-shm` sidecars (readonly open fails without them), import via `LEGACY_DATABASE_PATH=... bun run --cwd v2/backend src/db/importLegacyCli.ts` into a disposable `DATA_DIR`, and hash the root DB before/after (`parity:hash-root-db`).

## Milestone 0: Freeze Scope And Build The Parity Manifest

Create a machine-readable route and capability manifest before implementing further behavior.

For every legacy surface, record:

- Route and HTTP method.
- Auth mode and input variants.
- Request validation and normalization.
- Success and error response contract.
- Persistence entities affected.
- Streaming/content-type behavior.
- v1 source location.
- v2 implementation location.
- Classification: `parity`, `approved exclusion`, or `internal-only`.
- Test fixture and acceptance test location.

Group the manifest into:

- Public compatibility APIs: `/v1`, `/v1beta`, `/responses`, `/codex`.
- Dashboard management APIs: `/api/providers`, models, aliases, combos, proxy pools, settings, keys, usage, client auth.
- Authentication and OAuth/import APIs.
- Media and Gemini APIs.
- Dashboard-only and host-operation APIs.

Exit criteria:

- No legacy route is unclassified.
- Any proposed exclusion has explicit approval.
- The manifest identifies an owner milestone for every parity route.

## Milestone 1: Differential-Test Harness And Database Safety

Build the verification system before broad implementation work.

Implement:

- A launcher for root v1 and v2 with isolated environment variables and distinct ports.
- Read-only GET comparison against live root v1 and the resettable v2 copy.
- Disposable v1 and v2 database clones for mutation comparison.
- Canonical response comparison that removes dynamic values while preserving contract-relevant fields.
- Canonical logical database export and table/entity diffing.
- Fixture seeding for providers, nodes, aliases, disabled/custom models, combos, API keys, proxy pools, usage, and credentials.
- Failure output that identifies route, request fixture, response mismatch, and changed persistence rows.

Required comparison classes:

- Exact: status, content type, headers, JSON keys, validation errors, and fixed values.
- Normalized: generated IDs, timestamps, secrets, cookies, hashes, and token values.
- Streaming: event ordering, event schema, terminal event, usage event, and cancellation behavior.
- Persistence: intended rows/fields changed, unrelated rows unchanged, root database unchanged.

Exit criteria:

- A single command runs read-only route comparisons.
- A single command runs mutations against disposable v1/v2 copies.
- Both commands fail with actionable diffs.
- The root v1 database hash remains unchanged before and after every suite.

## Milestone 2: Management API And Persistence Parity

Complete and prove the management contract before changing dashboard behavior.

Scope:

- Providers, provider nodes, proxy pools, models, custom models, aliases, disabled models, context windows, combos, API keys, settings, usage, pricing, database export/import, client auth, and Zed settings.
- Exact envelopes, pagination, filtering, validation, no-store headers, secret redaction, and error semantics.
- Database export/import parity using real isolated v1 exports.
- Correct proxy-environment reapplication after import.

Required fixes include:

- Normalize frontend API client handling of `{ connections }`, `{ nodes }`, `{ proxyPools }`, `{ combos }`, `{ keys }`, `{ models }`, `{ aliases }`, `{ ids }`, and paginated detail envelopes.
- Align custom-model input naming and alias deletion transport with the backend contract.
- Wire implemented proxy-pool testing into the UI.
- Correct password verification used by settings database import.

Exit criteria:

- Differential tests pass for all approved management GET routes.
- Disposable mutation tests pass for create, update, delete, enable/disable, proxy assignment, custom model, alias, context window, settings, combo, key, and import/export operations.
- Every mutation proves only intended persistence changes.

## Milestone 3: Unified Model Resolution And Public Catalog Parity

Make one v2 model-resolution path authoritative for every public endpoint.

Implement:

- Recursive aliases and provider aliases.
- Provider-node prefix and reserved-prefix resolution.
- Static, live, custom, disabled, and combo models.
- Model kinds, capabilities, context metadata, virtual web models, and provider resolution.
- API-key model and combo access restrictions.
- Equivalent `/v1/models`, `/v1/models/{kind}`, and `/v1/models/info` behavior.

Exit criteria:

- Seeded fixture catalogs produce the same public model IDs, metadata, filtering, access behavior, and errors as v1.
- Dashboard model views and public model routes use the same resolver.

## Milestone 4: Provider Execution And Translation Core

Replace the narrow generic forwarding path with registry-driven execution.

Implement:

- Provider target URL, headers, credentials, proxy, project/session metadata, and transport selection.
- Request translators for OpenAI Chat, OpenAI Responses, Claude Messages, Gemini, Ollama, and provider-specific formats.
- Response translators for JSON and SSE.
- Tool calls, reasoning/thinking, images and multimodal content, cancellation, terminal events, and usage events.
- Representative specialized executors, then expand to every provider family in the manifest.

Exit criteria:

- Fixture tests verify upstream URL, headers, and request body for every target format.
- Client tests verify non-streaming JSON and streaming behavior for OpenAI, Responses, Claude, Gemini, Ollama, and each specialized provider family.
- No unsupported translation silently degrades request data.

## Milestone 5: Account Selection, Fallback, Refresh, And Usage

Match v1 resilience and accounting semantics.

Implement:

- Model-aware cooldowns and error classification.
- Rate-limit/reset handling and exponential backoff.
- Account rotation, preferred connection, sticky round-robin, combo account filters, custom order, combo identity, and fusion behavior.
- Proactive and provider-specific refresh flows.
- Credential rotation/deduplication and refreshed-token persistence.
- Streaming and non-streaming API-key usage accounting.

Exit criteria:

- Multi-account tests prove correct selection and rotation.
- Permanent/non-fallback errors stop fallback when v1 does.
- Rate-limited accounts become eligible only when v1-equivalent cooldown rules allow.
- Refresh and streaming scenarios persist expected credentials and usage rows.

## Milestone 6: Public Compatibility And Media APIs

Complete compatibility APIs that sit outside ordinary chat completion routing.

Scope:

- Root `/v1` and `/api/v1` aliases.
- Embeddings, images, speech, transcription, web search, web fetch, video, and voices.
- Multipart forwarding and binary/stream preservation.
- Ollama response conversion.
- Gemini `generateContent`, `streamGenerateContent`, and Gemini-native TTS behavior.

Exit criteria:

- Every approved public route has differential tests for validation, response schema, content type, and error behavior.
- Gemini streaming returns Gemini events, not translated OpenAI `[DONE]` events.
- Media endpoints execute through configured connections and preserve binary/multipart semantics.

## Milestone 7: OAuth, Native Auth, And Provider Imports

Complete provider lifecycle onboarding and maintenance.

Implement:

- Authorization-code OAuth with provider-specific PKCE rules.
- Device-code initiation and polling.
- Native authentication, cookies, token imports, API-key validation, and connection creation.
- Cursor, Kiro, GitLab, iFlow, Qoder, Codex, xAI, and Grok CLI flows.
- OAuth proxy/session lifecycle where required.
- Provider-specific refresh classification, deduplication, and error persistence.

Exit criteria:

- Every provider action in the manifest has mocked contract tests.
- Pending, success, rejected, expired, and retryable states match v1 response/persistence semantics.
- Dashboard onboarding executes real flows rather than creating placeholder connections.

## Milestone 8: Dashboard Functional Parity

Begin broad frontend work only after Milestones 1-7 are stable.

Implement:

- Account Groups route, sidebar entry, group management, rename, assignment, and ungrouping.
- Combo accounts compatibility route.
- Media combo detail route.
- Settings and pricing navigation, including currently orphaned pricing settings.
- Registry-driven provider cards and provider metadata.
- Real provider onboarding/auth dispatcher.
- Provider detail controls: edit, imports, test/fetch models, suggested models, context windows, compatible models, status diagnostics, cooldowns, Zed settings/organizations, and provider-specific settings.
- Proxy health/deployment controls, usage live activity, chat helper behavior, and capability-gated states.
- Correct dashboard data loading and mutation refresh behavior.

Exit criteria:

- Every supported sidebar action performs a real backend operation.
- No supported route falls through to Dashboard.
- Unsupported capability controls display a backend-provided reason and never indicate false success.
- Desktop and mobile navigation work without viewport overflow.

## Milestone 9: Shell, Navigation, And Visual Parity

Align v2 information architecture with v1 without retaining duplicate title ownership.

Implement:

- A single title ownership strategy.
- Breadcrumbs and contextual provider/media identity.
- Search, language selector, OIDC identity display, update/disconnect/shutdown states where supported.
- Consistent loading, empty, error, cooldown, and disabled-control states.
- Responsive sidebar/drawer behavior and theme contrast checks.

Exit criteria:

- Target screenshot and interaction comparisons pass for dashboard, provider list/detail, combo detail, settings, usage, media, and mobile navigation.
- Every navigation item has a working route and correct active state.

## Milestone 10: Host Operations And Explicit Scope Closure

Resolve the remaining non-core capabilities:

- Cloud sync.
- Tunnel lifecycle.
- MITM controls and certificate/trust operations.
- PXPIPE, token saver, headroom, and local MCP bridge.
- CLI host-file operations and updater/shutdown flows.
- Quota telemetry and provider-specific diagnostics.

For each item, either:

- Implement and test it, or
- Obtain explicit approval for an exclusion and present it as unavailable everywhere.

Exit criteria:

- No capability remains ambiguously partial.
- The manifest is fully resolved.

## Milestone 11: Final Verification And Cutover Readiness

Run the full verification sequence from clean environments:

```text
bun run --cwd v2 typecheck:backend
bun run --cwd v2 test:backend
bun run --cwd v2 typecheck:frontend
bun run --cwd v2 test:frontend
bun run --cwd v2 build:frontend
git diff --check
```

Then run:

- Full read-only live v1-v2 differential suite.
- Full disposable mutation/database-semantic suite.
- Provider-family contract suite.
- Compatibility streaming suite.
- Browser functional suite.
- Desktop/mobile visual comparison suite.
- Root database integrity and logical-export verification.

Cutover is blocked unless:

- All parity tests pass.
- All approved exclusions are documented in the manifest and UI.
- No root v1 database mutation is detected.
- The v2 isolated database can be recreated from a v1 export.
- Rollback remains possible by routing traffic back to root v1.

## Execution Order

1. Milestone 0: scope manifest.
2. Milestone 1: differential harness.
3. Milestone 2: management and persistence proof.
4. Milestone 3: model resolver.
5. Milestone 4: execution and translation.
6. Milestone 5: fallback, refresh, and usage.
7. Milestone 6: compatibility and media.
8. Milestone 7: OAuth and provider imports.
9. Milestone 8: dashboard functional parity.
10. Milestone 9: shell and visual parity.
11. Milestone 10: host-operation closure.
12. Milestone 11: final verification and cutover readiness.

No milestone may begin its dependent frontend implementation until its backend acceptance criteria pass.

### Landing page removal (2026-10-03)
- `/landing` and `LandingView.vue` were removed. The page had a fixed dark design with no theme tokens. Unknown paths already redirect to `/dashboard`.
