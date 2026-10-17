# 03: Refresh coordinator on the chat request path

**What to build:** Many concurrent chat requests on one Connection with an expiring or rejected token cause one refresh. All requests use the result of that refresh. A Provider that rotates refresh tokens no longer rejects the Connection after a burst.

**Blocked by:** 02 (Connection patch on the chat and gateway paths)

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md` (Refresh coordinator).

- [ ] A new refresh coordinator module in the providers domain takes the runtime, a Connection id, and an optional failed access token.
- [ ] The coordinator holds one in-flight refresh per Connection id. Concurrent callers for the same Connection get the same result.
- [ ] After it gets the lock, the coordinator reads the current Connection. If the access token differs from the failed token, or the token is not near expiry, it returns the current Credentials and does not refresh.
- [ ] The coordinator calls the Executor refresh function and stores the result through the Connection patch method. It marks the Connection active.
- [ ] The chat pre-dispatch refresh and the chat 401/403 retry use the coordinator.
- [ ] The request path makes one refresh attempt with no sleep between attempts.
- [ ] Executors that already use the OAuth credential manager lock (codex, grok-cli) still work. The coordinator is the only entry point for stored Connections.
- [ ] Test (HTTP seam): 20 concurrent requests on a Connection with an expiring token cause exactly one call to the mock refresh endpoint. All 20 requests succeed.
- [ ] Test (HTTP seam): 20 concurrent requests that each get a 401 cause exactly one refresh. Each request retries once with the new token.
- [ ] Test (HTTP seam): a refresh-token rotation is stored once, and the stored refresh token is the newest one.

## Comments

Implementer note: `refreshConnectionCredentials(runtime, connectionId, { failedAccessToken?, refresh?, log? })` in `backend/src/services/providers/refreshCoordinator.ts`. It joins one in-flight refresh per Connection id and stores only changed fields through `providers.patch`. The chat pre-dispatch refresh, the chat 401/403 retry, and the gateway 401 refresh use it. Synthetic Credentials in chat call the Executor once. Tests: `backend/tests/refreshCoordinator.test.ts`.

Orchestrator: accepted. Behavior changes: the coordinator also stores lastRefreshAt, projectId and apiKey when a refresh returns them; stores expiresAt but not expiresIn (no reader uses stored expiresIn); failed refreshes are not cached; synthetic credentials make one direct refresh. Ticket 04 must also migrate services/billing/autoclawTasksScheduler.ts (refresh + dataPatch stale spread).
