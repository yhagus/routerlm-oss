# 01: Load-test harness and event-loop metric

**What to build:** A maintainer runs one command and gets baseline numbers for router overhead under concurrent streams. The command starts the real server and a local mock Provider. The running backend also reports event-loop lag and logs slow SQLite queries. Later tickets use this command to record "before" and "after" numbers.

**Blocked by:** None (can start immediately)

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md` (Measurement). Targets: `.scratch/backend-concurrency/map.md`.

- [ ] One command starts the real server on a free port, a mock Provider that streams SSE with a set delay per chunk, and a load generator.
- [ ] Inputs: number of concurrent streams, new requests per second, test duration, chunk delay, and an optional dashboard load at the same time.
- [ ] Output: event-loop lag p99, router TTFB overhead p99 (TTFB minus mock first-byte delay), peak RSS, response count by status, and refresh calls that the mock received.
- [ ] The dashboard scenario calls the Usage dashboard endpoints while streams run.
- [ ] The backend exposes event-loop lag through the existing internal stats surface.
- [ ] The backend writes one log line when a SQLite query takes longer than a configurable threshold.
- [ ] A baseline run at a documented local load is recorded in this ticket under `## Comments`.
- [ ] The harness does not run as part of `bun run test`.

## Comments

### Baseline (2026-10-16)

Machine: Apple M3 Pro, 11 cores, 18 GB RAM, macOS, Bun 1.4.0. This is not the 2 vCPU reference hardware.

Mock Provider: first byte after 200 ms, 200 chunks at 50 ms (about 10 s per stream). One Connection. Server fetch cap is the Bun default (256).

Run A, streams only:

```bash
cd backend && bun run loadtest -- --streams 200 --rps 20 --duration 20
```

| Metric | Value |
| --- | --- |
| Event-loop lag p99 / max | 4.4 ms / 9.7 ms |
| Router TTFB overhead p50 / p99 / max | 3.8 ms / 10.9 ms / 15.5 ms |
| Peak RSS | 137 MB |
| Responses | 394 x 200 (6 arrivals skipped at the 200-stream cap) |
| Streams without `[DONE]` | 0 |
| Mock refresh calls | 0 |
| Slow queries (> 100 ms) | 0 |

Run B, same load plus the Usage dashboard at 2 requests per second and 100,000 seeded Usage rows:

```bash
cd backend && bun run loadtest -- --streams 200 --rps 20 --duration 20 --dashboard-rps 2 --seed-usage 100000
```

| Metric | Value |
| --- | --- |
| Event-loop lag p99 / max | 15.9 ms / 128.5 ms |
| Router TTFB overhead p50 / p99 / max | 3.4 ms / 118.3 ms / 146.8 ms |
| Peak RSS | 314 MB |
| Responses | 391 x 200 (9 arrivals skipped at the cap) |
| Dashboard latency p50 / p99 | 28.8 ms / 135.9 ms (39 x 200) |
| Slow queries (> 100 ms) | 0 |

Run B shows the dashboard problem from the spec. No single SQLite statement passes 100 ms. The JavaScript aggregation over all loaded Usage rows blocks the event loop for up to 128 ms. That pushes router TTFB overhead p99 above the 50 ms target.

Event-loop lag, memory, and the slow-query count are at `GET /api/usage/runtime-stats`. `POST /api/usage/runtime-stats/reset` clears the lag histogram. `SLOW_QUERY_MS` sets the slow-query threshold (default 100, `0` turns the log off).
