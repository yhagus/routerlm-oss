# 09: Usage SQL aggregation and pagination

**What to build:** A dashboard visit no longer freezes chat streams. Usage totals and chart series come from SQL aggregation, and Usage history lists use pagination. The dashboard shows the same numbers as before.

**Blocked by:** 01 (Load-test harness and event-loop metric), 06 (Single SQLite connection and shutdown order)

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md` (Usage queries and retention).

- [ ] Dashboard totals and chart series use SQL `GROUP BY` with a time filter. No dashboard endpoint loads all raw Usage rows into JavaScript.
- [ ] Usage history list endpoints accept a limit and a cursor and return the next cursor.
- [ ] The dashboard Usage views use the paginated API and show the same data as before.
- [ ] Test (HTTP seam): for a fixed set of recorded requests, each dashboard Usage endpoint returns the same totals and series as the current implementation.
- [ ] Test (HTTP seam): paging through history returns every row once, in order.
- [ ] Harness: the dashboard scenario with a large Usage table shows event-loop lag p99 below 50 ms. Record before and after numbers under `## Comments`.

## Comments

### Implementation (2026-10-16, branch `ch/09-usage-sql`)

- New read layer: `backend/src/db/usageQueries.ts`. `aggregateUsage(sqlite, scope, { by, buckets })` runs one `GROUP BY` query. Buckets are half-open ISO ranges joined through `json_each`. `usageRowsPage` returns raw rows newest first with a cursor.
- `usageHistory` has new derived columns: `cachedTokens`, `comboName`, `failed`, `successTps`, `successLatencyMs`. `usage.record` writes them. `deriveUsageFacts` fills rows from other writers at migration and before each read. A NULL `cachedTokens` marks such a row.
- The derive step also writes canonical `promptTokens` and `completionTokens` from the tokens JSON. Rows written by `usage.record` do not change.
- JSON parsing and `LOWER(status)` per row cost about 40 ms per 100,000 rows. The derived columns remove that cost.
- Without table statistics, SQLite scanned the whole provider index for time-bound `GROUP BY` queries. Time-bound queries without an equality filter now use `INDEXED BY idx_uh_ts`.
- New indexes: `idx_uh_apikey_ts (apiKey, timestamp)` and partial `idx_uh_underived (id) WHERE cachedTokens IS NULL`.
- `GET /api/usage/history?limit=&cursor=` returns `{ items, nextCursor }`. An invalid cursor returns 400. `/logs` and `/request-logs` keep their array shape and read with `LIMIT`.
- `GET /api/usage/providers` reads only the `(provider, connectionId, timestamp)` index.
- Dashboard view reads `history.items`. The Usage view uses `/request-details`, which already has page pagination over the bounded `requestDetails` table. It is unchanged.
- Dead legacy aggregations in `services/platform/db/repos/usageRepo.ts` are deleted (`getUsageStats`, `getChartData`, `getDashboardUsage`, `getUsageStatsFor*`, `getUsageTotalsBy*`, `getUsageHistory`, `getGrokCliRollingUsage`, `getActiveRequests`, `getRecentLogs`). Only the barrels re-exported them. `saveRequestUsage` stays.
- Tests: `backend/tests/usageSqlEquivalence.test.ts` pins 113 dashboard responses (snapshots written by the old JavaScript aggregation, fixed clock, `Asia/Kolkata`). `backend/tests/usageHistoryPagination.test.ts` pages through history.

### Harness (Apple M3 Pro, same machine as ticket 01)

```bash
cd backend && bun run loadtest -- --streams 200 --rps 20 --duration 20 --dashboard-rps 2 --seed-usage 100000
```

| Metric | Before (integration tip 1fbc9280), 2 runs | After, 2 runs |
| --- | --- | --- |
| Event-loop lag p99 / max | 14.0 / 116.9 ms; 13.7 / 111.7 ms | 8.0 / 30.7 ms; 7.6 / 27.5 ms |
| Router TTFB overhead p99 / max | 112.4 / 130.1 ms; 100.6 / 117.8 ms | 32.2 / 41.7 ms; 29.6 / 37.6 ms |
| Peak RSS | 300 MB; 322 MB | 163 MB; 164 MB |
| Dashboard latency p50 / p99 | 28.5 / 122.6 ms; 24.5 / 114.5 ms | 15.4 / 35.6 ms; 15.9 / 31.3 ms |
| Slow queries (> 100 ms) | 0; 0 | 0; 0 |
| Responses | 392 x 200 | 393 x 200 |

Event-loop lag p99 stays below 50 ms. The max lag and the TTFB overhead p99 also go below 50 ms.

Per-request cost at 100,000 rows (no load): dashboard 7d 12 ms, chart 7d 8 ms, stats 7d 4 ms, overview 24h 4 ms, providers 6 ms, by-provider all 20 ms, trend all 47 ms. Periods of "all" still scan every row. Ticket 10 rollups remove that cost.

### Orchestrator

Orchestrator: accepted. `/api/usage/history` now returns `{ items, nextCursor }`; the only in-repo consumer is the frontend (updated). The boot backfill rewrites promptTokens/completionTokens from the tokens JSON for old rows. 'All' periods still scan raw rows; ticket 10 rollups should remove that.
