# 10: Usage daily rollup and retention

**What to build:** An operator sets a retention period for raw Usage rows. Old rows move into daily rollups and are deleted, so the Usage table stops growing without limit. Dashboard totals for old periods stay correct. Request detail writes no longer count the full table on each flush.

**Blocked by:** 09 (Usage SQL aggregation and pagination)

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md` (Usage queries and retention).

- [x] A daily rollup table stores Usage totals per day, Provider, model, Connection, and API key.
- [x] A retention job writes rollups for raw rows older than the retention period, then deletes those raw rows, in one transaction per batch.
- [x] The retention period is a setting. The default keeps all raw rows. Record the default under `## Comments`.
- [x] Period totals combine rollup rows for old days and raw rows for recent days.
- [x] Request detail flush keeps the row count in memory and does not run a full count per flush. The max-records trim still works.
- [x] Test (HTTP seam): dashboard totals are the same before and after the retention job moves rows into rollups.
- [x] Test (HTTP seam): request details stay at or below the max-records setting after many flushes.

## Comments

### Implementation (2026-10-16, branch `ch/10-usage-rollup`)

- Setting: `usageRetentionDays`. Default `0`. The value `0` (or unset) keeps every raw Usage row. This is the old behavior.
- The dashboard shows the setting in Settings > Diagnostics as "Usage raw retention (days)".
- New table `usageDailyRollup`. One row holds the totals of one local day for one set of Provider, model, Connection, API key, combo name, and client IP. It also holds the failed count, the tokens-per-second and latency sums with their counts, `firstAt`, and `lastAt`.
- Job: `backend/src/services/platform/usageRetention.ts`. It runs 30 s after start and then every hour. `POST /api/usage/retention/run` runs it now. Each batch moves up to 2,000 rows in one transaction. The job yields to the event loop between batches.
- Reads: `aggregateUsage`, `usageProviderCounts`, and `usageTimeRange` in `backend/src/db/usageQueries.ts` add rollup rows to raw rows. Every dashboard total and series reads through them.
- Raw-row lists show raw rows only: `/api/usage/history`, `/logs`, `/request-logs`, and `recentRequests` in the stats views.
- The Grok CLI 24 h window reads raw rows. The minimum retention of 1 day keeps that window raw.

### Time-zone decision

- The rollup day is the server's local calendar day. The dashboard slots are local days. A UTC day would put rows of two local days into one slot.
- The cutoff is the local midnight `usageRetentionDays` days before today. The periods `today`, `7d`, `30d`, and `60d` start at a local midnight. They never split a rolled-up day.
- A read places a rollup row by its `lastAt`. A range that starts inside a rolled-up day takes the whole day or none of it. Only the overview "previous" window and fixed 24 h buckets across a DST change can start inside a day.
- Real sums (cost, tokens per second, latency) add in a different order after rollup. They can differ in the last floating-point digit. Integer totals stay exact.
- Test `backend/tests/usageRetention.test.ts` (TZ `Asia/Kolkata`) has rows at 23:45 and 00:15 local time around two local midnights. In UTC each pair falls on one date. A UTC day key fails the test (checked by mutation).

### Request details

- `backend/src/services/chat/requestDetails.ts` keeps the row count per runtime in memory. It runs one `COUNT(*)` on the first flush only.
- An insert of a new id adds one. An update of a stored id adds nothing. The trim subtracts the deleted rows.
- The old code counted before the insert, so the table could exceed the maximum by one batch. The trim now holds the table at the maximum after each flush.
- The observability config cache is now per runtime. Before, a second runtime in one process read the settings of the first.

### Tests

- `backend/tests/usageFixture.ts`: the fixture from `usageSqlEquivalence.test.ts`, now shared. The 113 snapshots are unchanged.
- `backend/tests/usageRetention.test.ts`: every aggregate dashboard path gives the same JSON before and after the job moves 9 of 20 rows into rollups. It also checks the default (moves nothing), local-day slots, and a second run.
- `backend/tests/requestDetailsTrim.test.ts`: the table stays at `observabilityMaxRecords` over many flushes, and an update does not drop a row.

### Harness (Apple M3 Pro)

```bash
cd backend && bun run loadtest -- --streams 200 --rps 20 --duration 20 --dashboard-rps 2 --seed-usage 100000 [--dashboard-period all] [--usage-retention-days 7]
```

New harness flags:

- `--dashboard-period <p>` sends dashboard, chart, stats, overview, trend, and by-provider requests for that period.
- `--usage-retention-days <n>` sets the setting and runs the job before the load phase. The seed spans 30 days, so 7 days of retention moves about 74,300 rows.

| Scenario | Lag p99 / max (ms) | TTFB overhead p99 (ms) | Dashboard p50 / p99 (ms) | Peak RSS (MB) |
| --- | --- | --- | --- | --- |
| 7d mix, retention off (4 runs) | 13.8 / 41.6; 13.9 / 85.2; 15.2 / 48.2; 13.3 / 40.8 | 35.0; 39.3; 33.4; 41.0 | 21.6 / 36.0; 23.3 / 37.4; 21.8 / 36.5; 21.4 / 44.5 | 168-179 |
| 7d mix, retention 7 | 12.4 / 51.6 | 41.1 | 20.4 / 47.6 | 169 |
| "all" periods, retention off | 52.9 / 213.8 | 149.0 | 71.2 / 224.3 | 180 |
| "all" periods, retention 7 | 20.3 / 62.4 | 54.5 | 35.4 / 70.3 | 189 |

All runs had 0 slow queries and only 200 responses. The job moved 74,335 rows in 324 ms (one HTTP call, 38 batches).

Per-request cost at 100,000 rows without load (median of 7), before and after retention 7 (115 rollup rows):

- by-provider all: 21.1 -> 5.4 ms
- trend all: 59.5 -> 15.2 ms
- dashboard all: 56.7 -> 14.5 ms
- chart all: 40.5 -> 10.1 ms
- stats all: 16.0 -> 4.2 ms
- overview all: 110 -> 29.3 ms
- overview 30d: 118 -> 30.1 ms
- dashboard 7d: 12.7 -> 12.7 ms

With retention off, "all" periods still scan every raw row. The operator must set `usageRetentionDays` to get the gain.

### Orchestrator

Orchestrator: accepted. With retention on, raw lists (history, logs, recentRequests) show only rows newer than the cutoff, and float sums may differ in the last digit. 'All' period speed-up needs `usageRetentionDays` > 0.
