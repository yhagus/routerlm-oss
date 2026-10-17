# v2 Frontend Parity Inventory (Milestones 8/9)

Side-by-side inventory of v1's dashboard (Next.js, `src/app/(dashboard)/…`, current working tree incl. the uncommitted account-groups work — that tree is authoritative) against v2's frontend (`v2/frontend/src`, Vue 3 + vue-router + Pinia + vue-query).

Scope rule: **match v1 exactly — no additions; investigate and remove v2-only pieces.**

Buckets: `REMOVE` (v2-only, delete), `PORT` (v1-only, build in v2), `COMPLETE` (exists in v2 but partial).

## Route comparison

Legend: ✅ parity (verify visually), 🟡 complete, 🔴 port, ⚫ remove (v2-only), 🟣 keep-as-redirect (temporary).

### Top-level routes

| v1 URL | v1 file | v2 URL | v2 file | Status |
|---|---|---|---|---|
| `/` | `src/app/page.js` (redirect /dashboard) | `/` | router redirect | ✅ |
| `/login` | `src/app/login/page.js` (rate-limit countdown, OIDC button, must-change-password) | `/login` | `views/LoginView.vue` (password only) | 🟡 COMPLETE (OIDC button, countdown, must-change flow) |
| `/login/guest` | `src/app/login/guest/page.js` | `GuestLoginView.vue` | 🟡 PORTED (browser verify) |
| `/landing` | `src/app/landing/page.js` + components | _(removed)_ | ⚫ REMOVED (owner decision 2026-10-03: no landing page in v2) |
| `/callback` | `src/app/callback/page.js` (OAuth code/token/state/error exchange) | `CallbackView.vue` | 🟡 PORTED (browser verify) |
| `/connect` | `src/app/connect/page.js` (public key usage/limits) | `ConnectView.vue` | 🟡 PORTED (backend `/api/connect` already ported; browser verify) |
| `/client` | `src/app/(client)/client/page.js` (portal welcome, gated by `/api/client/auth/status`) | `ClientView.vue` | 🟡 PORTED (browser verify) |
| `/client/qoder-injector` | `src/app/(client)/client/qoder-injector/page.js` (job runner, polling, quota) | `QoderInjectorView.vue` | 🟡 PORTED (browser verify) |
| — | — | `/:pathMatch(.*)*` → /dashboard | router | ✅ v1 Next 404s unknown paths; acceptable shell behavior (verify) |

### Dashboard routes

| v1 URL | v1 file (under `src/app/(dashboard)/dashboard/`) | v2 file (under `v2/frontend/src/views/`) | Status |
|---|---|---|---|
| `/dashboard` | `page.js` + `DashboardHome.js` | `DashboardView.vue` | 🟡 COMPLETE (v2 has hardcoded degraded states: live request stream, combo attribution) |
| `/dashboard/account-groups` | `account-groups/page.js` (untracked in v1) | `AccountGroupsView.vue` | ✅ verify behaviors (rename, bulk move, per-row select) |
| `/dashboard/account-pool` | `account-pool/page.js` (static empty-state table) | `AccountPoolsView.vue` | ✅ parity (tabs and empty-state table match v1; browser verify) |
| `/dashboard/basic-chat` | `basic-chat/page.js` (hidden from sidebar, full-bleed) | `BasicChatView.vue` (not sidebar-linked) | 🟡 COMPLETE (trim localStorage-session/image extras if v1 lacks them; match v1 minimal chat) |
| `/dashboard/chat` | `chat/page.js` (sandbox/MCP tools via `/api/dashboard/chat/*`) | `ChatView.vue` (templates/clear/stop) | 🟡 COMPLETE → deferred session (tools UI) |
| `/dashboard/cli-tools` | `cli-tools/page.js` (~25 tool cards) | `CLIToolsView.vue` | 🟡 COMPLETE (MITM Tools section vs v1's placement; card set parity) |
| `/dashboard/cli-tools/[toolId]` | `cli-tools/[toolId]/page.js` | `CLIToolDetailView.vue` | 🟡 COMPLETE (local-file apply now invokes the real writer) |
| `/dashboard/combos` | `combos/page.js` | `CombosView.vue` | 🟡 verify strategy/fusion/judge fields against `ComboFormModal` |
| `/dashboard/combos/[id]/accounts` | `combos/[id]/accounts/page.js` (group-by-group select/deselect) | `ComboDetailView.vue` | 🟡 COMPLETE (group toggles parity) |
| `/dashboard/console-log` | `console-log/page.js` | `ConsoleLogView.vue` | ✅ verify SSE source parity |
| `/dashboard/devices` | `devices/page.js` | `DevicesView.vue` | ✅ verify |
| `/dashboard/endpoint` | `endpoint/page.js` (local/remote rows incl. cloudflared/tailscale, key CRUD, limits, security warning) | `EndpointView.vue` | 🟡 COMPLETE (tunnel start/stop controls now live here) |
| `/dashboard/free-tracker` | `free-tracker/page.js` | `FreeTrackerView.vue` | ✅ verify |
| `/dashboard/media-providers/[kind]` | `media-providers/[kind]/page.js` | `MediaKindView.vue` | ✅ verify (kind set: embedding, image, video, tts, stt) |
| `/dashboard/media-providers/[kind]/[id]` | `[kind]/[id]/page.js` + example cards | `MediaDetailView.vue` | 🟡 verify `MediaRequestPanel` vs v1 example cards |
| `/dashboard/media-providers/web` | `media-providers/web/page.js` | `MediaWebView.vue` | ✅ verify |
| `/dashboard/media-providers/combo/[id]` | `media-providers/combo/[id]/page.js` (dedicated edit: name, models, accounts) | redirect → `/combos/:id/accounts` | 🟣 keep redirect; PORT dedicated page next session |
| `/dashboard/mitm` | `mitm/page.js` | `MitmView.vue` | 🟡 COMPLETE (Start/Stop/Trust/DNS now call live backend) |
| `/dashboard/profile` | `profile/page.js` (sections: workspace, data, access, routing, network, diagnostics) | `SettingsView.vue` (same sections) | 🟡 verify field parity per section |
| `/dashboard/providers` | `providers/page.js` | `ProvidersView.vue` | 🟡 verify grouping/labels/test-all |
| `/dashboard/providers/new` | `providers/new/page.js` (real custom-node creation) | `ProviderNewView.vue` (stub) | 🟡 COMPLETE (build real v1 form) |
| `/dashboard/providers/[id]` | `providers/[id]/page.js` | `ProviderDetailView.vue` + provider components | 🟡 IN PROGRESS (connections, cooldowns, proxy bulk actions, model controls, thinking picker, Zed/Qoder controls ported; provider-specific auth polish and visual verification remain) |
| `/dashboard/proxy-pools` | `proxy-pools/page.js` (test, dead-disable, deploy) | `ProxyPoolsView.vue` | 🟡 verify deploy/test coverage |
| `/dashboard/pxpipe` | `pxpipe/page.js` (hidden from sidebar) | `PxpipeView.vue` (unlinked after developer-hub removal) | 🟡 COMPLETE (Start/Stop/Restart/Install/Health wired) |
| `/dashboard/quota` | `quota/page.js` | `QuotaView.vue` | 🟡 verify fields ("Not exposed by v2" notices vs real backend) |
| `/dashboard/skills` | `skills/page.js` | `SkillsView.vue` | ✅ verify |
| `/dashboard/token-saver` | `token-saver/page.js` | `TokenSaverView.vue` | 🟡 COMPLETE (Headroom/PXPIPE controls and extras wired) |
| `/dashboard/tools` | `tools/page.js` (Qoder Injector PAT) | `ToolsView.vue` | ✅ verify |
| `/dashboard/translator` | `translator/page.js` (shown when `enableTranslator`) | `TranslatorView.vue` | 🟡 v1 uses internal trace endpoints `/api/translator/*` — verify v2 surface matches what v1 shows |
| `/dashboard/usage` | `usage/page.js` (5 tabs, drawers, topology, limits) | `UsageView.vue` (5 tabs) | 🟡 COMPLETE (topology/limits/drawers) → partially deferred |
| `/dashboard/settings/pricing` | `src/app/dashboard/settings/pricing/page.js` — **orphan in v1, no nav link** | `PricingSettingsView.vue` | ⚫ REMOVE nav discoverability; keep route (match v1 orphan) |

### v2-only routes to remove

| v2 URL | v2 file | Disposition |
|---|---|---|
| `/dashboard/api-keys` | `ApiKeysView.vue` | ⚫ REMOVE (v1 manages keys in `/dashboard/endpoint` only) |
| `/dashboard/models` | `ModelsView.vue` | ⚫ REMOVED after relocating alias/custom-model/context-window controls into provider detail |
| `/dashboard/provider-nodes` | `ProviderNodesView.vue` | ⚫ REMOVED after inlining compatible-node edit into provider detail |
| `/dashboard/mcp` | `McpView.vue` + `components/tools/McpPanel.vue` | ⚫ REMOVE (no v1 counterpart) |
| `/dashboard/developer` | `DeveloperView.vue` | ⚫ REMOVE (no v1 counterpart) |
| `/dashboard/operations/tunnels` | `TunnelsView.vue` | ⚫ REMOVE (v1 exposes tunnels in `/dashboard/endpoint`; ensure parity there first) |
| `/dashboard/integrations` | redirect → cli-tools | ⚫ REMOVE alias |
| `/dashboard/media/web`, `/dashboard/media/:kind(/:id)` | redirects | ⚫ REMOVE (v2-internal legacy, never v1 URLs) |
| `/dashboard/settings` | redirect → profile | ⚫ REMOVE (v1 has no such route; only `/dashboard/settings/pricing`) |
| media kinds `music`, `imageToText` | `lib/media.ts` + routes | ⚫ REMOVE (v1 keeps them commented out of `VISIBLE_MEDIA_KINDS`) |
| — | `UnavailableView.vue`, `components/app/CapabilityUnavailable.vue`, `components/media/CapabilityUnavailable.vue`, `CopyField.vue` | ⚫ REMOVE dead components (never imported) |

## Shell parity (Milestone 9)

v1 sidebar (`src/shared/components/Sidebar.js`): w-72, macOS traffic-light motif, logo + version; groups Main / Accounts & Routing / Integrations / System (Media accordion; conditional Translator; hidden basic-chat + pxpipe entries exist commented out).

v1 header (`src/shared/components/Header.js`) — all missing from v2 `Topbar.vue`:
- Breadcrumbs on provider-detail and media-detail paths.
- Contextual `HeaderSearch` backed by per-page zustand store.
- Language selector (`LanguageSwitcher`, cookie locale, `translate()` everywhere).
- OIDC identity pill (`/api/auth/status`).
- HeaderMenu: Change Log modal, theme, Shutdown (confirm → `/api/version/shutdown`), Logout.
- Update check via `/api/version` → `ConfirmModal` → `ManualUpdatePanel`.
- Full-screen "Server Disconnected" overlay.
- Mobile hamburger + slide-in sidebar with overlay (`DashboardLayout.js`); content `max-w-[1600px]`, grid background.

Status: 🔴 PORT (deferred to a later session; tracked here).

## Provider-detail gaps (v1 `providers/[id]` → v2 `ProviderDetailView.vue`)

~~All items below~~ **Fixed (2026-08-17, provider-detail parity slice):** the page, connection row, and every child modal were rebuilt in v1's structure/design language (Material Symbols icons, v1 layout). `lib/providerMeta.ts` is generated from the v1 registry (names, aliases, colors, notices, deprecation risk notices, `modelsFetcher` configs, regions, noAuth). Original gap list kept for reference:

Available Models card:
- ~~🔴 thinking-level select (`providerThinking` per provider)~~
- ~~🔴 ModelRow chips: copy full name, alias set/delete, per-model test, disable, caps badges, thinking suffix~~ (`ProviderModelRow.vue` + `CapacityBadges.vue`; caps now served by `/api/models` via the v1 capabilities resolver)
- ~~🔴 suggested free models (≥200k ctx)~~ (all 10 `modelsFetcher` providers through `/api/providers/suggested-models`, not just kilocode)
- ~~🔴 disabled-models restore list~~ + Disable All/Active All buttons
- ~~🔴 Fetch Qoder Models / Fetch Cursor API Models buttons~~ (v1 semantics incl. alerts and registered-count message)
- ~~🔴 `QoderModelContextWindows` (qoder)~~ (ported component; "max Nk" defaults from caps)
- ~~🔴 `CompatibleModelsSection` for compatible providers~~ (manual add + Import from /models + per-row test/copy/delete)
- ~~🟡 custom-model add~~ (`AddCustomModelModal` port: inline Test with reachable/error feedback, strip-alias preview)

Connections card:
- ~~🔴 bulk Apply Proxy modal (one-to-one rotate / unbind all / bind pool)~~ (`BulkProxyModal.vue`, v1 title/summary/actions)
- ~~🔴 group-by-folder headers ("Ungrouped" last) + group badges~~ (folder icon + count, only when multiple groups, like v1)
- ~~🔴 `CooldownTimer` (`modelLock_*` fields) + cooldown-aware status badge~~ (⏱ orange mono timer; expired "unavailable" reads active)
- ~~🟡 masked proxy URL + `no_proxy` badge~~ (Pool:/Legacy: text, masked URL code, no_proxy line, per-row proxy dropdown)
- ~~🔴 autoPing toggle (claude/codex OAuth rows)~~ (bolt button + v1 tooltips, settings-persisted per connection)
- ~~🔴 Zed organization selector~~ (per-row select with plan/personal labels, loading/updating/error/warning states)
- ~~🟡 priority move up/down~~ (v1 index-swap semantics)
- ~~🔴 `EditConnectionModal` parity incl. Group field + `groupOptions` datalist~~ (plus API-key Check with re-validate-on-save, Test Connection, Azure/Cloudflare/region fields)
- ~~🟡 one-by-one test + round-robin/sticky~~ (v1 summary bar: Total/Completed/Passed/Failed/Stopped/Running; 1s delay; stop flag)

Provider-level:
- ~~🔴 Zed settings card (shared System ID, `PATCH /api/providers/zed/settings`)~~ (inline Input + Save + applied-count message)
- ~~🔴 deprecated-warning + info notice banners~~ (RISK_NOTICE token resolved; blue info banner with Get API Key button)
- ~~🔴 external "Get API Key / Sign up" link~~ (from registry notice/website)
- ~~🟡 add-connection modes~~ — dual OAuth/API-Key labels (xai/grok-cli/kimi wording), iflow Cookie, Bulk Add for codex/qoder/xai/grok-cli (`BulkImportModal.vue` with v1 placeholders/payloads), grok-cli Export (grok2api JSON download), `NoAuthProxyCard` (proxy pool + rotate strategy via providerStrategies), `AddApiKeyModal` port (Single/Bulk modes, Check validation, compatible default model, proxy-pool select, Ollama/Azure/Cloudflare/region/cookie fields), antigravity AG-risk confirm modal (localStorage-gated).

Backend fixes en route: `PUT/POST /api/providers` now persist v1's flat patch fields (`group`, `defaultModel`, `testStatus`, `lastError`, `lastErrorAt`, `apiKey`, `providerSpecificData`) into the data bag and validate `proxyPoolId` (400 "Proxy pool not found"); `/api/models` attaches v1 `getCapabilitiesForModel` caps to built-in rows; `api.providers.test` exposes v1's `valid` field alongside `ok`. Connection-test consumers fixed to read `valid` (the one-by-one runner previously marked every test failed).

## Session 3 — Add-Connection / OAuth parity (2026-08-17)

The v2 unified `ProviderAuthModal` was replaced with v1's exact modal set — the old modal built its own redirect URI (`/dashboard/providers/:id`) instead of v1's fixed `localhost:1455/auth/callback` for Codex, so OpenAI rejected the authorize URL (the reported "Codex OAuth stopped working"), and it had none of v1's proxy/polling/callback machinery:

- **`ProviderOAuthModal.vue`** — full port of v1 OAuthModal: device-code flow with auto-polling (`slow_down` backoff, upstream `expires_in` deadline, per-provider `extraData` for kiro/qoder/kimi), codex (port 1455) and xai (port 56121) server-side proxy + `poll-status`, trae/windsurf dynamic-port proxy + paste-token fallback with `ide-status`, localhost popup with postMessage/BroadcastChannel/localStorage callback relay (matching v1's `/callback` page), manual paste fallback (raw-JWT `eyJ` detection, xai manual-code, kimchi token), v1's waiting/success/error steps, and proxy cleanup on close/unmount.
- **`KiroOAuthWrapper.vue` + `KiroAuthModal.vue`** — v1 method selection (Builder ID / IAM Identity Center with start-URL+region form / API key / Import refresh token / Import CLIProxyAPI JSON); social login stays hidden as in v1. **`CursorAuthModal.vue`** (auto-import from the IDE's SQLite + manual paste), **`GitLabAuthModal.vue`** (OAuth App PKCE with clientId/baseUrl meta → embedded OAuth modal, or PAT), **`IFlowCookieModal.vue`**, **`NativeAuthModal.vue`** (Zed loopback: start → popup → status poll → manual callback completion).
- `providerAuthModes` is now registry-driven (`providerMeta().authModes`, incl. top-level registry authModes like kimchi's free-tier paste-token OAuth) with the hardcoded sets as fallback.
- Backend: exchange route regained v1's raw-JWT path (pasted `eyJ…` token → `access_token` connection with ChatGPT account claims); `stop-proxy` is a GET like v1.
- Chat stream verified through the gateway: streaming SSE (role/content deltas, finish, usage incl. `reasoning_tokens`) and — after fixing a real bug — non-streaming: Gemini-family executors answer with `{"candidates":…}` JSON which `normalizeToJsonOpenai` used to pass through untranslated; new `fromGeminiShape` converter returns proper OpenAI completions (verified live: `chat.completion` with message/usage).
- Provider catalog verified complete: all 120 v1 registry ids present in the v2 Providers grid, none extra.
- Live-verified on the dev instance: codex modal produces the real `auth.openai.com` URL with `redirect_uri=http://localhost:1455/auth/callback` + PKCE and arms the 1455 listener (`serverSide:true`, poll `pending`, released on close); qoder device modal shows the device URL + user code + polling; kiro Builder-ID shows the AWS device code UI; iflow Cookie modal renders v1-style.

Remaining known divergences (tracked): the v2 shell still renders its own "Provider Detail" page title above the v1-style content (part of the deferred shell/header parity item).

## Session 2 — Quota Tracker → CLI Tools design parity (2026-08-17)

Rule from the owner: these four pages must look/behave like v1 (switcher toggles, not disable/enable buttons) and use v1's unported assets (Material Symbols icon font, tool images).

Done:

- **Assets**: added `material-symbols@0.44.6` (same package v1 uses) imported in `main.ts`, with v1's `.material-symbols-outlined` CSS (incl. `fill-1`) appended to globals; copied the one missing provider asset (`kimchi.svg` — v2 `public/providers` now 138/138 vs v1).
- **Shared components**: `ui/toggle.vue` (v1 Toggle switcher, sm/md/lg), `ui/modal.vue` (v1-style modal), `ui/ConfirmModal.vue`, `connections/EditConnectionModal.vue` (name/priority/group + API-key Check + Test Connection), `lib/quota.ts` (port of v1 ProviderLimits utils incl. per-provider `parseQuotaData`), `usage/QuotaTable.vue` (compact table, emoji/bars/countdown labels, hide-row action, per-table pagination).
- **Quota Tracker**: rewritten on v1's ProviderLimits architecture — data flows through `/api/providers/client` + `/api/usage/:connectionId` (v1's path; the v2-only `/api/quota` aggregator is no longer used by the view), provider dropdown menu with icons, account-status filter, codex sort select, Expiring-first, Turn off Empty / Turn on Available bulk actions, auto-refresh chip (`toggle_on` + countdown, tab-visibility pause, Claude 3-min throttle), refresh-all, provider-grouped cards with more_vert menus (codex reset limit + reset-credits modal, auto-ping, refresh quota, edit, delete), Toggle switchers, hidden-row chips (settings-backed `quotaVisibility` with rollback), full pagination footer (page-size select + custom input + First/Prev/Next/Last), kiro method/region/ARN badges, v1 empty states.
- **Free Tracker**: v1 layout — intro + updated timestamp, auto-refresh chip, per-source cards with icon (InferHub default + initials fallback), Public/Private **Toggle**, per-card refresh, note line, model rows with emoji + progress bars + used/left labels.
- **Token Saver**: v1 TokenSaverClient — single Card (bolt heading), RTK/Headroom/Caveman/Ponytail rows with Toggle switches, level pill pickers with descriptions, Headroom Setup/Manage modal (status, dashboard link, proxy URL, start/stop/install command + copy, recheck), compression extras chips (active toggles + uninstall, pending install with install-log polling, `[ml]` ~1GB confirm), PXPIPE row stays hidden (dead code in v1).
- **CLI Tools**: v1 catalog + layout — `lib/cliTools.ts` carries v1's field values (image/color/description) and tool order (18 tools incl. cursor/roo/continue/amp/qwen/deepseek-tui/jcode/grok-build/devin); compact `ToolSummaryCard` (image + name + status pill Unknown/Not installed/Connected/Not configured) and `MitmLinkCard` (image + MITM pill + description); max-w-5xl grid + MITM Tools section with security icon. Replaced the v2-only `CliToolCard.vue`.
- Verified: `typecheck:frontend` clean, `test:frontend` green, `build:frontend` green, and a browser smoke on a disposable instance confirmed all four pages render v1-style (switches, icon ligatures, quota toolbar/pagination, tool cards).

Follow-ups found:

- ~~Backend: `/api/usage/:connectionId` still lacks per-provider usage adapters~~ **Fixed (2026-08-17):** `services/providerUsage.ts` ports v1's GET `/api/usage/[connectionId]` — `getUsageForProvider` from open-sse (all ~20 provider adapters), executor credential refresh with v1 sparse-patch persistence, auth-expired force-refresh retry, and the grok-cli Daily-Allowance merge (rolling usage computed over v2's `usageHistory` with v1's 24h window). Verified live: gemini-cli renders real quota rows; qoder test accounts correctly surface the adapter's 401 message.
- ~~Qoder quota cards showed "Usage fetch returned 401"~~ **Fixed (2026-08-17):** v1-shaped (seeded) rows keep provider extras in a nested `providerSpecificData` inside v2's data bag; the usage route and chat credential selector aliased the whole bag, hiding qoder's `personalAccessToken`/`userId` so the PAT re-login never ran. `resolveV1ProviderSpecificData` picks the nested object when present; refresh persistence merges extras into the nested copy (regression test in backend usageExtras). Verified live: both qoder accounts render full quota tables (Personal + Qwen3.8-Max event rows).
- The v2-only `/api/quota*` backend routes are now unused by the UI; candidates for removal in the next backend hygiene pass (v1 has no `/api/quota`).

## Session 1 scope (this doc's checkboxes)

- [x] Removal pass (all ⚫ above, incl. sidebar/branding match)
- [ ] Un-gate stale host-op controls (MITM, tunnels in endpoint, headroom/PXPIPE, CLI apply) — backends are real as of the backend-completion slice
- [ ] Port top-level pages (landing, login/guest, callback, connect, client, qoder-injector)
- [x] Provider-detail completion (gaps above — see continuation log)
- [ ] Verify: `bun run --cwd v2 typecheck:frontend && bun run --cwd v2 test:frontend && bun run --cwd v2 build:frontend` + browser smoke

### Provider-detail continuation log

- [x] Vendor browser-safe thinking capability/level resolution with Kiro guards and focused tests.
- [x] Add frontend API contracts for provider settings, model fetch/test, aliases, disabled models, context windows, Kilo models, Zed organizations, and Grok export.
- [x] Port connection grouping, cooldown/status diagnostics, proxy assignment and bulk proxy actions, edit modal, auto-ping, Zed organizations, and sequential tests.
- [x] Port model test/copy/alias/disable/restore/custom actions, thinking suffixes, Qoder/Cursor fetch actions, Kilo suggestions, and Qoder context-window overrides.
- [x] Verify with frontend typecheck, tests, build, `git diff --check`, and the Impeccable mechanical detector.
- [ ] Browser smoke against an isolated v2 runtime; provider-specific auth/import polish remains tracked above.

Deferred (tracked above): account-pool real port, media-combo dedicated page, chat tools UI, usage subcomponents, shell/header parity, visual screenshots, backend leftovers (grok-cli schedulers, manifest hygiene, model-list re-diff vs current v1 build).

## Session 4 — Provider-detail action parity: row/batch tests, validate, models/fetch, suggestions (2026-08-17)

Owner request: every action on the provider detail page must work as in v1 — test by connection (one-by-one), test per row, and all button actions. Full inventory diff of v1 `providers/[id]/page.js` + `ConnectionRow.js` against v2's view/rows/routes found four backend divergences, all fixed:

- **`POST /api/providers/:id/test`** — was a generic `GET {baseUrl}/v1/models` probe. Now `services/connectionTest.ts` ports v1's `testSingleConnection` wholesale: `OAUTH_TEST_CONFIG` probe table (codex's 400-accept responses probe, gemini-cli/antigravity Cloud Code Assist + userinfo, qoder userinfo, grok-cli `/v1/user` with CLI headers + 402 spending-limit soft-success, iflow query-param userinfo, github/gitlab/kilocode/kimchi URLs, cursor/codebuddy token-exists, claude/qwen/kiro/kimi checkExpiry), token refresh (`refreshOAuthToken` incl. executor-backed codex/grok-cli/xai) with expired/401 retry, the full API-key switch (40+ providers incl. compatible-node models probe, anthropic-compatible messages probe, cursor-api CLI validation, qoder PAT exchange, grok-web/perplexity-web cookie probes, registry fallback), connection-proxy resolution (pool → relay → legacy) with pre-test proxy health check, and v1 persistence (`testStatus: "active"/"error"`, soft-warning lastError, rotated tokens merged nested-aware).
- **`POST /api/providers/validate`** (Add Connection "Check" button) — was the same generic probe. Now ports v1's validate route: compatible-node 404 contracts, cursor-api, custom-embedding models→embeddings fallback, web/media config-driven probes, the provider switch (fixed a port bug found live: openrouter must hit `/api/v1/auth/key`, not the public `/v1/models`), vertex SA-JSON checks, commandcode/grok-web/perplexity-web, and the registry chat-probe fallback.
- **`POST /api/providers/test-batch`** — now runs the real per-connection `testSingleConnection` (probe + refresh + persistence) with v1's result shape instead of the generic probe.
- **`POST /api/providers/:id/models/fetch`** (cursor-api) — was generic re-discovery. Now v1's flow: `crsr_` validation, `listCursorApiModels`, `cursorApiModels` persisted into providerSpecificData, models registered under the `capi` alias with newly-registered count.
- **`GET /api/providers/suggested-models`** — was a generic kind-substring filter that returned data for types v1 rejects. Now ports v1's FILTERS exactly (`openrouter-free` zero-priced ≥200k sort, `opencode-free` `-free` suffix + `big-pickle`, `mimo-free`), with unknown types 400ing like v1 (frontend caches an empty list).
- Frontend: `updateSettings` now PATCHes only the changed keys (v1 semantics) instead of echoing the whole sanitized settings object back.

Regression tests: `tests/connectionTest.test.ts` (qoder userinfo probe + v1 status persistence, compatible psd.baseUrl probe, gemini-cli expired→refresh→retry→token persistence, codex 400-accept, validate contracts); parity/runtime tests updated to assert v1 contracts (models/fetch 400 for non-cursor-api, openrouter-free filter, api.openai.com row-test probe).

Live-verified on the dev instance: qoder row test → `valid:true` via real userinfo probe with `testStatus:active` persisted; test-batch 2/2 passed; gemini-cli row test valid; browser — enable toggle (disabled→active badge + error text), per-row Test (clears lastError on success), one-by-one (Total/Completed/Passed/Failed summary + success badges), Round Robin toggle + Sticky persisted to `providerStrategies`, Edit modal (Name/Email/Priority/Group datalist) save + rename reflected, Add-Model modal Test surfaces upstream errors (`cancel` icon + message); suggested-models 400/200 per v1; validate bogus vs real keys correct. Note: model ping on qoder currently 503s because both test accounts are out of Qoder quota (code 112) — correct v1 behavior (auth test passes, chat quota doesn't).
