# Spec: Concurrency hardening for the backend

Status: done

Related map: `.scratch/backend-concurrency/map.md` (load targets and topology limits). This spec uses the targets and limits from that map.

## Problem Statement

LobakAI routes client requests to many Providers through a pool of Connections. The operator runs one Bun process with one SQLite database.

Under concurrent load, the operator sees these problems:

- A Connection stops working after a burst of requests. The Provider rejects its refresh token. The operator must log in to the Connection again.
- Many concurrent requests refresh the same Credentials at the same time. Providers that rotate refresh tokens accept only one refresh. The other refreshes fail.
- A request that waits on a slow Provider writes an old copy of the Connection when it ends. This old copy replaces Credentials, cooldown state, and other changes that other requests wrote during the wait.
- The "round-robin" strategy does not rotate. All traffic goes to one Connection until that Connection gets a 429 error.
- LobakAI has no limit on concurrent requests. A traffic spike causes a chain of Fallback attempts across all Connections.
- A dashboard visit can freeze all active chat streams. The dashboard loads all Usage history into memory with synchronous SQLite reads.
- A slow client makes memory grow. The stream reads from the Provider faster than the client receives.
- Two SQLite connections write the same data through two data layers. One layer bypasses the in-memory cache. On shutdown, the second layer can stop the process before the last Usage batch is written.

The operator also believed that a different database (MongoDB) would fix these problems. The analysis showed that the database engine does not cause them. The application logic causes them.

## Solution

The operator keeps one Bun process and SQLite. LobakAI changes its application logic so that concurrent requests do not damage Connection state, and load spreads across Connections.

After this work:

- A Connection keeps valid Credentials under any number of concurrent requests.
- Only one refresh runs for one Connection at one time. Concurrent requests share its result.
- A change to a Connection never replaces fields that the change did not name.
- The round-robin strategy rotates through all eligible Connections.
- LobakAI limits concurrent requests per Connection, per API key, and globally. When a limit is full, LobakAI rejects fast and does not queue.
- Dashboard queries do not block chat streams.
- Each stream reads from the Provider only as fast as the client receives.
- All application code uses one SQLite connection and one data layer.
- A load-test harness measures each change against the targets in the map.

## User Stories

### Credentials safety

1. As an operator, I want a Connection to keep valid Credentials during a burst of concurrent requests, so that I do not need to log in to the Connection again.
2. As an operator, I want only one refresh to run for one Connection at one time, so that a Provider that rotates refresh tokens does not reject the Connection.
3. As an API client, I want my request to use the new access token when another request has already refreshed it, so that my request does not start a second refresh.
4. As an API client, I want my request to retry once with the new access token after a 401 or 403, so that a token that expired during my request does not fail the request.
5. As an operator, I want the background token refresh scheduler and the request path to share the same refresh lock, so that they never refresh the same Connection at the same time.
6. As an operator, I want media requests (images, embeddings) to use the same refresh path as chat requests, so that every refresh is safe.
7. As an operator, I want dashboard actions that refresh a Connection to use the same refresh path, so that a manual action does not break a running request.
8. As an API client, I want the request path to make at most one refresh attempt without a sleep, so that a failed refresh does not add seconds to my request.

### Connection state integrity

9. As an operator, I want a request that ends late to write only the fields it changed, so that it does not restore old Credentials.
10. As an operator, I want a cooldown that one request writes to stay in place when another request ends, so that LobakAI does not send traffic to a rate-limited Connection.
11. As an operator, I want a success that one request writes to clear only the error fields, so that it does not change Credentials or model locks.
12. As an operator, I want changes to nested provider-specific data to merge with the current nested data, so that one change does not remove other nested fields.
13. As a maintainer, I want one repository method that applies a partial change to a Connection, so that every caller uses the same safe merge.
14. As a maintainer, I want the code base to have no caller that writes a full copy of Connection data taken before an `await`, so that this class of bug cannot return.

### Load distribution

15. As an operator, I want the round-robin strategy to move to the next eligible Connection when the sticky limit is reached, so that load spreads across all Connections.
16. As an operator, I want round-robin to skip Connections that are in cooldown, excluded, or locked for the requested model, so that rotation uses only usable Connections.
17. As an operator, I want to set a maximum number of in-flight requests per Connection for each Provider, so that one Connection does not receive more requests than the Provider allows.
18. As an operator, I want Connection selection to skip a Connection that is at its in-flight limit, so that the next request goes to a Connection with free capacity.
19. As an operator, I want the default per-Connection limit to be "no limit", so that current behavior stays the same until I set a limit.
20. As an operator, I want to set a maximum number of concurrent requests per API key, so that one client cannot use all capacity.
21. As an API client, I want a 429 response with `Retry-After` when my API key is at its concurrency limit, so that I know when to retry.
22. As an operator, I want a global in-flight cap, so that the process does not run out of memory during a spike.
23. As an API client, I want a fast 503 response with `Retry-After` when the global cap is full, so that my client can retry or use another route.
24. As an operator, I want a maximum number of Fallback attempts per request, so that one failing request does not try every Connection in a large pool.
25. As an operator, I want a request to receive a 503 with `Retry-After` when every eligible Connection is at its limit, so that LobakAI does not queue requests.
26. As an operator, I want the in-flight count to decrease when a stream ends, fails, or the client disconnects, so that capacity returns to the pool.

### Single data path

27. As an operator, I want all application code to use the one SQLite connection that the runtime opens, so that the in-memory cache always matches the database.
28. As an operator, I want `BACKEND_DATABASE_PATH` to control the only database file, so that no code writes to a second file.
29. As an operator, I want graceful shutdown to write the last Usage batch before the process exits, so that I do not lose Usage on a normal stop.
30. As a maintainer, I want only one module to own shutdown signal handlers, so that no other module can exit the process early.

### Event loop health

31. As an API client, I want my stream to continue without pauses when an operator opens the dashboard, so that my response time stays stable.
32. As a dashboard user, I want Usage totals and charts to come from SQL aggregation, so that the dashboard does not load all Usage rows into memory.
33. As a dashboard user, I want Usage history lists to use pagination, so that one page load reads a bounded number of rows.
34. As an operator, I want old raw Usage rows to be summarized into daily rows and then deleted after a configurable number of days, so that the Usage table does not grow without limit.
35. As a dashboard user, I want totals for old periods to stay correct after raw rows are deleted, so that retention does not change my reports.
36. As an operator, I want request detail writes to avoid a full table count on every flush, so that observability does not add load per request.

### Streaming memory

37. As an operator, I want each stream to read from the Provider only when the client is ready for more data, so that a slow client does not increase memory.
38. As an operator, I want a stream to keep only the data it needs for Usage and the request detail, so that a long response does not keep every chunk in memory.
39. As an API client, I want the remote image download for my request to stop when I disconnect, so that LobakAI does not use resources for a request that ended.
40. As an API client, I want my stream to keep the current event format, terminal events, and `[DONE]` behavior, so that my client does not need changes.

### Measurement

41. As a maintainer, I want a load-test harness that starts the real server and a local mock Provider, so that I can measure router overhead without a real Provider.
42. As a maintainer, I want the harness to report event-loop lag p99, router TTFB overhead p99, peak memory, and refresh count, so that I can compare each change with a baseline.
43. As a maintainer, I want the harness to run a dashboard load at the same time as chat streams, so that I can see if dashboard queries block streams.
44. As a maintainer, I want the harness to accept the number of streams and the request rate as inputs, so that I can test the map targets (2,000 streams, 100 new requests per second).
45. As an operator, I want a metric for event-loop lag, so that I can see blocking in a running process.
46. As an operator, I want a log line for SQLite queries that take more than a set time, so that I can find slow queries.

## Implementation Decisions

### Process and storage topology

- LobakAI keeps one Bun process and SQLite. The engine stays `bun:sqlite`, synchronous, in WAL mode.
- The in-memory cache of Connections, API keys, and settings stays the source of truth for the hot path.
- All design changes must stay correct in one process. Multi-process mode is not part of this spec.

### Connection patch method (Connection repository)

- The Connection repository gets one method that applies a partial change to Connection data.
- The method reads the current row from the in-memory cache, merges the change, and writes it. It runs synchronously with no `await` between read and write.
- The method merges the nested provider-specific data object with its current value. It does not replace that object.
- Callers send only the fields they change. A field set to `null` clears that field.
- The current full-update method stays for dashboard edits that replace a full Connection on purpose.
- All callers that now spread a Connection data copy into an update change to the patch method. These callers are in the gateway success and error paths, the chat project-id hydration, the token refresh scheduler, media refresh paths, provider discovery, special-auth validation, the tools test route, the models route, and provider extras routes.
- Pending deferred writes (last-used markers from round-robin) for a Connection must not overwrite a newer patch. The deferred write queue stores the merged cache state at flush time, not a copy from enqueue time.

### Refresh coordinator (new deep module in the providers domain)

- One module owns every Credentials refresh for a stored Connection. Its interface takes the runtime, the Connection id, and an optional access token that failed.
- The module holds one in-flight refresh per Connection id. Concurrent callers for the same Connection receive the same result.
- After the module gets the lock, it reads the current Connection. If the current access token differs from the failed token, or the token is not near expiry, the module returns the current Credentials and does not refresh.
- The module calls the Executor's refresh function, then writes the result through the Connection patch method. It also marks the Connection active, as the current persist step does.
- The request path makes one refresh attempt with no sleep. The background scheduler may keep its retry behavior.
- The existing per-provider refresh lock in the OAuth credential manager stays for synthetic or unsaved Credentials. For stored Connections, the coordinator is the only entry point.
- All refresh call sites change to the coordinator: the chat pre-dispatch refresh, the chat 401/403 retry, the token refresh scheduler, media endpoints, provider discovery, and provider extras routes.

### Connection selection

- Round-robin: when the most recently used Connection reaches the sticky limit, selection picks the next eligible Connection in priority order after it, and wraps to the first.
- Selection reads the in-flight count per Connection from the existing pending-request tracking.
- A new per-Provider setting sets the maximum in-flight requests per Connection. The default is no limit.
- Selection skips a Connection at its limit. Fill-first picks the first Connection with free capacity. Round-robin treats a full Connection as not eligible.
- In-flight tracking must start before the first `await` after selection. This prevents two requests from taking the last slot of the same Connection.

### Admission control

- A global in-flight cap applies to chat and media routes. When it is full, LobakAI returns 503 with `Retry-After`. LobakAI does not queue. This follows the overload policy in the map.
- A per-API-key concurrency limit is a new API key setting. When it is full, LobakAI returns 429 with `Retry-After`. The existing per-key requests-per-second and requests-per-minute limiter stays.
- The global cap and per-key limits release when a non-stream response ends, when a stream ends, and when the client disconnects.
- A per-request Fallback cap limits the number of Connections that one request tries. The default value is decided during implementation and recorded in the ticket.
- When all eligible Connections are at their in-flight limit, the request ends with 503 and `Retry-After`. Error bodies follow the existing gateway error format and do not name the Provider or the Connection pool.

### Single data layer

- The legacy data layer under the platform domain stops opening its own SQLite connection. Its callers move to the repositories, or the legacy layer uses the runtime's SQLite handle.
- The legacy adapter's signal handlers and its periodic `TRUNCATE` checkpoint are removed. The main entry point owns shutdown. A passive checkpoint on the main connection is allowed if WAL growth needs it.
- Graceful shutdown order: stop the server, stop schedulers, flush Usage and request details, close SQLite, exit.

### Usage queries and retention

- Dashboard totals and chart series use SQL `GROUP BY` with a time filter. They do not load raw rows into JavaScript.
- Usage history list endpoints use limit and cursor pagination.
- A daily rollup table stores Usage totals per day, Provider, model, Connection, and API key.
- A retention job writes daily rollups for raw rows older than the retention period, then deletes those raw rows in one transaction per batch. The retention period is a setting. The default keeps current behavior until the operator sets a value.
- Period totals combine rollup rows for old days with raw rows for recent days.
- Request detail flush keeps a row count in memory and does not run a full count per flush.
- A Bun Worker with a read-only connection for heavy reports is optional. It is used only if the harness shows lag above target after the SQL changes.

### Streaming

- The chat stream changes from a push loop in the stream start function to a pull-based stream. The stream reads one upstream chunk when the client asks for data.
- The stream keeps a running Usage sniff and a bounded summary for the request detail. It does not keep every translated chunk.
- The stall timer, client-cancel propagation, terminal Responses events, and `[DONE]` behavior stay the same.
- Remote image prefetch receives the request abort signal.

### Measurement

- The load-test harness is a script in the backend workspace. It starts the real server on a random port and a mock Provider server that streams SSE with a set delay per chunk.
- The harness reports event-loop lag p99, router TTFB overhead p99 (TTFB minus mock Provider first-byte delay), peak RSS, error counts by status, and refresh calls received by the mock.
- The backend exposes event-loop lag through the existing internal stats surface. A slow-query log line prints when a SQLite query takes longer than a threshold.

## Testing Decisions

### What makes a good test

- A test drives LobakAI through its HTTP surface and checks what a client or operator can see: response status, response body, stored Connection state, Usage totals, and calls that the mock Provider received.
- A test does not check private functions, internal maps, or call order inside a module.
- A concurrency test starts many requests at the same time with `Promise.all` and controls timing through the mock Provider (delayed or held responses). It does not use real time sleeps when a held promise can control the order.
- Tautological tests are not allowed (see `AGENTS.md`). A test must fail when the behavior is wrong.
- Per `AGENTS.md`, the test session runs once after all tickets are complete. Failures are fixed, then the full suite runs a final time.

### Seam 1: HTTP app with fetch mock (agreed)

- Tests create a runtime with an in-memory database, call `createApp(runtime).request(...)`, and control the Provider with `installFetchMock` from the existing fetch harness.
- Behaviors tested at this seam:
  - Twenty concurrent requests on a Connection with an expiring token cause one call to the mock refresh endpoint. All twenty requests succeed with the new token.
  - Twenty concurrent requests that each get a 401 cause one refresh. Each request retries once.
  - The background scheduler tick and a request refresh at the same time cause one refresh.
  - A slow request that started before a refresh ends after the refresh. The stored Connection keeps the new access token and refresh token.
  - A slow request that ends with success after another request wrote a cooldown leaves Credentials unchanged and clears only error fields.
  - Round-robin with three Connections and a sticky limit spreads requests across all three. Assertions use the Authorization header that the mock received.
  - With a per-Connection limit of N and held mock responses, request N+1 goes to another Connection. When all Connections are full, the request gets 503 with `Retry-After`.
  - A per-key concurrency limit returns 429 with `Retry-After`. The slot returns after the held request ends or the client aborts.
  - The global cap returns 503 with `Retry-After`.
  - The Fallback cap stops after the set number of Connections.
  - Dashboard Usage totals match the sum of recorded requests before and after retention moves rows into rollups.
  - A streamed response keeps the same frames, terminal events, and `[DONE]` as before.
- Prior art: `tests/execution.test.ts`, `tests/fallbackParity.test.ts`, `tests/pendingTracking.test.ts`, `tests/rateLimit.test.ts`, `tests/quotaStaleRefresh.test.ts`, `tests/runtime.test.ts`, and the preload harness `tests/fetchHarness.ts`.

### Seam 2: load-test harness (agreed)

- The harness runs outside `bun test`. It is the evidence source that the map requires.
- Each ticket that claims a performance change records a baseline run and an after run in the ticket.
- Checks against the map targets: router TTFB overhead p99 below 50 ms, 2,000 concurrent streams, 100 new requests per second, on the reference hardware or a documented local equivalent.
- The dashboard scenario must show event-loop lag p99 below 50 ms while streams run.

## Out of Scope

- A change of database engine (MongoDB, Postgres, libSQL) or any external service such as Redis. The analysis showed that the engine does not cause these problems.
- Multi-process or multi-node deployment. Per-key and per-Connection limits are exact only in one process.
- Request queues. Overload rejects fast and does not queue.
- Changes to the frontend, except where an existing dashboard view needs the new paginated Usage API.
- New Provider features, new Executors, or changes to request and response translation.
- Changes to the quota snapshot scheduler. ADR 0015 already bounds its concurrency.
- Changes to connection test jobs. ADR 0016 already runs them one at a time.
- Docker alignment. The map aligns Docker after the spec is done.

## Further Notes

- Priority order for tickets: (1) Connection patch method and caller migration, (2) refresh coordinator, (3) round-robin fix, (4) single data layer, (5) per-Connection, per-key, and global limits, (6) Usage aggregation and retention, (7) pull-based streams. Build the load-test harness first so that later tickets can record baselines.
- Items 1 and 2 fix data damage. They need correctness tests, not performance numbers.
- The Connection patch method is a wide refactor across many callers. Sequence it as expand, migrate in batches, then contract with a guard that no caller spreads Connection data into a full update.
- The in-memory cache and the deferred write queue assume one process. A later multi-process effort must replace them. Record that decision in an ADR when that effort starts.
- LobakAI has no `CONTEXT.md` yet. This spec uses the terms that the code uses: Provider, Connection, Credentials, Executor, Fallback, cooldown, Usage, API key, combo.
