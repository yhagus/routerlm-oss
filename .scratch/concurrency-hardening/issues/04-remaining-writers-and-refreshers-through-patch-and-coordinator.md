# 04: Remaining Connection writers and refreshers through patch and coordinator

**What to build:** Every other place that changes a Connection or refreshes its Credentials uses the patch method and the refresh coordinator. The background token refresh scheduler and a request never refresh the same Connection at the same time. A guard stops new code from writing a full copy of Connection data. This is the second migrate batch and the contract step.

**Blocked by:** 02 (Connection patch on the chat and gateway paths), 03 (Refresh coordinator on the chat request path)

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md` (Connection patch method, Refresh coordinator).

- [ ] The token refresh scheduler uses the coordinator and the patch method. Its nested provider-specific data merge goes through the patch method.
- [ ] Image and embedding refresh paths use the coordinator.
- [ ] Provider discovery and provider extras refresh paths use the coordinator.
- [ ] Special-auth validation, the tools test route, and the models route use the patch method with only changed fields.
- [ ] The legacy codex email backfill writes through the repositories, not through a second data layer.
- [ ] A guard test fails if backend source passes a spread copy of Connection data into the full-update method.
- [ ] Test (HTTP seam): a scheduler tick and a chat request that both see an expiring token cause exactly one refresh.
- [ ] Test (HTTP seam): a media request and a chat request on the same expiring Connection cause exactly one refresh.

## Comments

Implementer note: Background jobs and probes call `refreshExpiringCredentials(runtime, id, credentials, { proxyOptions })` in `refreshCoordinator.ts`. Media 401/403 paths call `refreshMediaCredentials` in `services/media/shared.ts`. Model discovery (kiro, grok-cli, gemini-cli), provider extras backfill, connection test, and provider usage refresh through the coordinator. `providers.patch` now also takes `name` and `email`. `providerSpecificPatch(connection, fields)` builds a nested or flat data patch. The legacy `backfillCodexEmails` in `oauth/providers/index.ts` had no callers and is deleted; the live one in `routes/providerExtras.ts` uses `providers.patch`. Guard: `backend/tests/connectionFullUpdateGuard.test.ts`. Tests: `backend/tests/refreshCoordinatorCallers.test.ts`.

Orchestrator: accepted. For code review: (1) codebuddy nested providerSpecificData token copy is no longer updated by the coordinator; verify no codebuddy executor reads tokens from the nested copy; (2) AutoClaw connection test refreshes twice and the identity backfill drops the rotated refresh token (pre-existing); (3) the guard does not catch indirect spreads via a variable.
