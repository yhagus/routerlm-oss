# 12: Final verification against map targets

**What to build:** The maintainer has one record that shows the full test suite passes and the backend meets, or does not meet, each target in the map. Per `AGENTS.md`, this is the single full test session after all tickets.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md`. Targets: `.scratch/backend-concurrency/map.md`.

- [x] `bun run typecheck` passes. (Backend keeps the 2 `camoufox` errors that also occur on master. Frontend has 0 errors.)
- [x] `bun run test` passes. Fix failures, then run the full suite one final time.
- [x] The harness runs at the map targets (2,000 concurrent streams, 100 new requests per second) on the reference hardware or a documented local equivalent.
- [x] Results are recorded under `## Comments`: router TTFB overhead p99, event-loop lag p99 with and without dashboard load, peak RSS, and response counts by status.
- [x] Each target that is not met has a short note with the measured value and the suspected cause.

## Comments

### Typecheck (integration tip 5ec2bec6 and after this ticket)

- `cd backend && bun run typecheck`: 2 errors. Both are the `camoufox` module errors in `services/github/cbIntlCli.ts` and `services/gsuite/gsuiteCbIntlCli.ts`. Master has the same 2 errors. This spec adds no error.
- `bun run --cwd frontend typecheck`: 0 errors.

### Full test suite

| Run | Backend | Frontend |
| --- | --- | --- |
| First (tip 5ec2bec6) | 525 pass, 0 fail (68 files, 113 snapshots) | 42 pass (14 files) |
| Second (after the changes below) | 524 pass, 1 fail | not run (`&&` stops after the backend) |
| Final | 525 pass, 0 fail | 42 pass |

- No test was changed. No product fix was necessary.
- The one failure in the second run is `parity.test.ts` > "supports admin API-key list pagination with stored keys". It is flaky on master too: 4 of 40 runs fail on master 8c8a2d45, 2 of 30 on this branch. Cause: `keys.list()` sorts by `createdAt DESC`. The test expects insertion order, which holds only when both keys get the same millisecond. This spec does not touch that code. The test stays as it is.

### Changes in this ticket

- Production fetch cap. Bun queues outbound `fetch` above `BUN_CONFIG_MAX_HTTP_REQUESTS` (default 256, maximum 65,535). Each in-flight stream holds one upstream fetch. The global in-flight cap (`maxInFlightRequests`) defaults to 2500. So the fetch cap must be above 2500.
  - `ecosystem.config.cjs` (reference deploy) exports `BUN_CONFIG_MAX_HTTP_REQUESTS=4096` before `bun run src/main.ts`. A value in the environment overrides it. The existing `ulimit -n 65535` stays. 4,096 upstream sockets plus 4,096 client sockets fit in that limit.
  - `Dockerfile` sets `ENV BUN_CONFIG_MAX_HTTP_REQUESTS=4096`.
  - Evidence: with the Bun default (256), the stream-only run below gives TTFB overhead p50 17,974 ms and p99 53,926 ms. Only 1,024 streams finish, 1,488 are unfinished at exit, and the mock never sees more than 256 streams.
- Harness option `--server-cpus <list>` (Linux only). It starts the server through `taskset -c <list>`.

### Test setup

Two scenarios, each with `--streams 2000 --rps 100 --duration 30 --server-max-http 4096`. Chunks per stream: 400 at 50 ms, first byte 200 ms, so a stream lasts about 20.2 s. That is 40,000 upstream chunks per second at the peak.

- Scenario A: streams only.
- Scenario B: scenario A plus `--dashboard-rps 2 --seed-usage 100000`.

All recorded runs set `NODE_ENV=production`, as PM2 and Docker do. Without it the server writes dev-only `[DBG]` lines, which cost CPU.

Two environments:

- Local host: Apple M3 Pro, 11 cores, 18 GB, macOS, Bun 1.4.0. `ulimit -n` is 1,048,576. This host is a busy desktop (load average about 5 with no test). It is not the reference hardware.
- Local equivalent of 2 vCPU / 2 GB: Docker Desktop VM (4 vCPU, 8 GB), image `oven/bun:1.4.0` (Debian), `--ulimit nofile=65535`. The server is pinned to CPUs 0 and 1 (`--server-cpus 0,1`). The load generator and the mock Provider are pinned to CPUs 2 and 3 (`taskset -c 2,3 bun run loadtest ...`). A container memory limit would also count the load generator. So the server memory check uses its peak RSS against 2 GB. One VM vCPU is one M3 core, so this is probably faster than one cloud vCPU.

Command (container):

```bash
taskset -c 2,3 bun run loadtest -- --streams 2000 --rps 100 --duration 30 --server-max-http 4096 --server-cpus 0,1 [--dashboard-rps 2 --seed-usage 100000]
```

### Results

TTFB is router TTFB overhead (client TTFB minus the 200 ms mock first byte). Lag is server event-loop lag. All responses in all runs are `200`. No run has a non-200 response, a stream without `[DONE]`, a mock refresh call, or a slow query (> 100 ms). "Skipped" counts arrivals that the harness did not send because 2,000 of its streams were open. The router did not reject them.

2 vCPU equivalent (container, server on 2 CPUs):

| Scenario | Run | TTFB p50 / p99 / max (ms) | Lag p99 / max (ms) | Peak RSS (MB) | Responses | Skipped | Dashboard p50 / p99 (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 1 | 2.9 / 67.5 / 137.3 | 20.7 / 358.8 | 374 | 2,932 x 200 | 68 | - |
| A | 2 | 3.0 / 27.3 / 96.5 | 21.7 / 87.4 | 372 | 2,945 x 200 | 55 | - |
| A | 3 | 3.3 / 111.9 / 278.7 | 19.6 / 282.3 | 393 | 2,920 x 200 | 80 | - |
| A | 4 | 2.5 / 17.9 / 45.9 | 17.0 / 51.4 | 422 | 2,946 x 200 | 54 | - |
| B | 1 | 4.3 / 475.5 / 662.0 | 32.0 / 613.7 | 456 | 2,905 x 200 | 95 | 11.7 / 603.0 |
| B | 2 | 2.9 / 22.8 / 62.5 | 18.7 / 140.7 | 431 | 2,944 x 200 | 56 | 9.1 / 42.1 |
| B | 3 | 2.5 / 58.7 / 287.2 | 22.7 / 285.0 | 482 | 2,941 x 200 | 59 | 9.2 / 25.5 |
| B | 4 | 3.1 / 55.7 / 161.2 | 17.4 / 156.5 | 453 | 2,936 x 200 | 64 | 8.7 / 29.2 |

Runs A1, A2, B1 and B2 also had a `/proc` CPU sampler (one shell, every 2 s) in the container.

Local host (no CPU pinning):

| Scenario | Run | TTFB p50 / p99 / max (ms) | Lag p99 / max (ms) | Peak RSS (MB) | Responses | Skipped | Dashboard p50 / p99 (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 1 | 2.1 / 17.3 / 53.5 | 13.6 / 73.9 | 370 | 2,970 x 200 | 30 | - |
| A | 2 | 1.7 / 16.3 / 44.5 | 10.3 / 62.3 | 380 | 2,972 x 200 | 28 | - |
| A | 3 | 2.0 / 17.7 / 49.6 | 11.6 / 234.2 | 372 | 2,972 x 200 | 28 | - |
| A | 4 | 2.4 / 17.3 / 38.9 | 16.5 / 42.2 | 371 | 2,971 x 200 | 29 | - |
| B | 1 | 3.5 / 195.1 / 310.0 | 26.1 / 335.6 | 423 | 2,947 x 200 | 53 | 11.1 / 279.6 |
| B | 2 | 3.0 / 379.6 / 721.2 | 28.6 / 579.9 | 448 | 2,924 x 200 | 76 | 11.5 / 692.8 |
| B | 3 | 2.4 / 47.8 / 125.7 | 11.9 / 103.5 | 428 | 2,970 x 200 | 30 | 10.3 / 33.2 |

Summary against the map targets:

| Target | 2 vCPU equivalent | Local host | Result |
| --- | --- | --- | --- |
| 2,000 concurrent streams | 2,000 open at the mock, all finish with `[DONE]`, 0 rejects | same | Met |
| 100 new requests per second | 100 rps offered for 30 s, every sent request gets `200` | same | Met |
| Memory within 2 GB | peak RSS 372-482 MB | 370-448 MB | Met |
| Router TTFB overhead p99 < 50 ms | A: 17.9-111.9 ms (median 47.4, 2 of 4 runs pass). B: 22.8-475.5 ms (median 57.2, 1 of 4 runs pass) | A: 16.3-17.7 ms (4 of 4 pass). B: 47.8-379.6 ms (1 of 3 pass) | Not met on 2 vCPU |
| Event-loop lag (no map target) | p99 17-32 ms, max 51-614 ms | p99 10-29 ms, max 42-580 ms | p99 below 50 ms; max spikes |

### Target not met: router TTFB overhead p99 < 50 ms on 2 vCPU

Measured: scenario A median p99 47.4 ms (worst 111.9 ms). Scenario B median p99 57.2 ms (worst 475.5 ms). Both vary a lot from run to run.

Suspected cause: the server JavaScript thread is CPU-saturated at this load. Evidence:

1. The server process uses 103-154% CPU in the container at the peak. JavaScript runs on one thread, so one vCPU is full. The other vCPU only runs GC and I/O helper threads.
2. The lag spikes are queueing, not one blocking call. A CPU profile (`--cpu-prof`) has no sample gap during a 250 ms stall. JSC GC pauses are 5.4 ms or less (`BUN_JSC_logGC=1`). In runs with `SLOW_QUERY_MS=10` and a transaction timer, no SQL statement or transaction longer than 10 ms runs at the largest stall.
3. The worst spike in most runs comes about 20 s into the load, when the first streams finish. Each finish adds Usage, pricing, request detail, and log work to a full loop.
4. SQLite WAL checkpoints run inside the request-detail flush commit. These commits take 10-88 ms about every 3 s. One 88 ms commit matched a 99 ms lag gap.
5. In scenario B some dashboard queries (7-day `GROUP BY` over 100,000 rows) take 15-28 ms of synchronous SQL on the local host. They run on the same full loop.

Server CPU profile during the load phase (container, scenario A, share of samples):

| Work | Share |
| --- | --- |
| Per-chunk translate: `JSON.parse`, SSE frame `JSON.stringify`, completion accumulator (`chat.ts` `handleRaw`, `converters.ts`) | 39.5% |
| Stream plumbing: `pull`, `read`, `enqueue`, decode/encode, Bun stream natives | 29.5% |
| Pricing and capability lookup: `matchPattern` builds a new `RegExp` for each pattern on each call; the harness model matches no pattern, so each request scans the full list | 7.6% |
| Log line timestamps: `toLocaleTimeString` in `sse/utils/logger.ts` (`line`, `info`), 2-3 lines per request | 6.8% |
| Stall timer `setTimeout`/`clearTimeout` per chunk | 5.2% |
| Request detail capture and flush | 4.7% |
| Usage record, request setup, other SQLite, other | 6.5% |

The profiler takes fewer samples than its interval suggests, so read the shares as approximate.

On the local host, scenario A meets the target in all 4 runs. Scenario B misses in 2 of 3 runs. The host is a busy desktop. In two dev-mode runs the load generator stalled at the same moment as the server, so some host spikes come from the host, not from LobakAI.

Candidate follow-ups (outside this spec; each needs harness evidence first):

- Run 2 server processes on one node (`Bun.serve` `reusePort`). The map allows this. It uses the second vCPU. Per-key limits then become approximate.
- Pass bytes through for same-format streams. Parse only for the Usage sniff and the summary.
- Compile pricing and capability patterns once.
- Use one cached `Intl.DateTimeFormat` for log timestamps.
- A high-concurrency profile that turns off request detail capture, or a larger WAL auto-checkpoint with checkpoints outside the request path.

Orchestrator: accepted. The Dockerfile `ENV BUN_CONFIG_MAX_HTTP_REQUESTS=4096` is required for the 2,000-stream target, and the three small dashboard setting controls are the fields that tickets 07 and 08 asked for.
