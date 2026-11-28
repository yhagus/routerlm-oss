# k6 performance tests

Load tests for the gateway's inference endpoints (`POST /v1/chat/completions`,
`/v1/messages`, `/v1/responses`). k6 is the client; every Provider is a fake
upstream (`fake-upstream.js`):

```
k6 (client)  ->  gateway (2 CPU / 2 GB)  ->  fake upstream (Provider)
```

## Two ways to test

| Mode                                                | Upstream                                                                                    | Load                                | Answers                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Gateway alone** (`SCENARIO=raw`)                  | `/instant`: no latency, no pacing, 20 tokens                                                | fixed request **rate** (open model) | How many req/s does the router stack take, with the upstream out of the way?                                         |
| **End to end** (`mixed`, `edge`, `upstream`, `all`) | `/paced`: 200 ms to the first token, then 100 tokens/s, 200 tokens (about 2.2 s per answer) | fixed number of **VUs**             | What does a client see through a realistic upstream, with held-open streams, big prompts and a misbehaving upstream? |

## The one-VM budget

`docker-compose.yml` caps the gateway (`backend`) at **2 CPUs and 2 GB of RAM**
(no swap), as one small VM would have. The rest of the stack has its own caps,
so a run is repeatable:

| Service         | CPUs | Memory | Note                                |
| --------------- | ---- | ------ | ----------------------------------- |
| `backend`       | 2    | 2 GB   | the gateway under test              |
| `worker`        | 1    | 1 GB   | drains the usage queue              |
| `db` (Postgres) | 1    | 1 GB   | data in tmpfs, empty at every run   |
| `redis`         | 0.5  | 512 MB | nothing persisted                   |
| `fake-upstream` | -    | -      | one Bun process, uncapped           |
| `k6`            | -    | -      | uncapped; see "Reading the results" |

It builds the production image (`bun dist/main.js`), runs migrations with
`dist/migrate.js`, then seeds the Models and one API Key with `seed.ts`. Nothing
is published to the host, and the Compose project (`routerlm-oss-k6`) is separate
from the dev stack.

## Benchmark (one command)

```sh
bun run perf:k6
```

Runs the two scenarios, one minute each, each on a fresh stack (about 6 minutes
with the build), and prints one table per scenario: the spec of every node, total
time, total requests, requests per second, failures, latency, and the average CPU
and memory each node used. Raw output stays in `results/` (gitignored).

| Node                 | Spec                                                  |
| -------------------- | ----------------------------------------------------- |
| Gateway (app)        | 2 CPU / 2 GB: 2 replicas of 1 CPU / 1 GB behind nginx |
| Worker               | 1 CPU / 1 GB                                          |
| PostgreSQL           | 1 CPU / 1 GB                                          |
| Redis                | 0.5 CPU / 512 MB                                      |
| Fake upstream, nginx | test equipment: 1 CPU / 512 MB, 1 CPU / 256 MB        |
| k6                   | uncapped, test equipment                              |

The two replicas are because one gateway process is one event loop and uses one
CPU. `TOPOLOGY` picks how the 2 CPU / 2 GB budget is spent (`run.sh`):

| `TOPOLOGY`       | Gateway                                                               | k6 targets             |
| ---------------- | --------------------------------------------------------------------- | ---------------------- |
| `dual` (default) | `backend-a`, `backend-b`: 2 containers of 1 CPU / 1 GB behind nginx   | `lb:8080`              |
| `single`         | `backend`: 1 container of 2 CPU / 2 GB, 1 process                     | `backend:3000`         |
| `cluster`        | `backend-cluster`: 1 container of 2 CPU / 2 GB, `BACKEND_PROCESSES=2` | `backend-cluster:3000` |

`cluster` is how a self-hoster runs one VM (ADR 0025): the processes share one
port, with no load balancer. `TOPOLOGY=cluster bun run perf:k6` benchmarks it.

`BUN_CONFIG_MAX_HTTP_REQUESTS` is set to 4096 on the gateway: Bun's default of 256
simultaneous outbound requests per process capped it at about 107 req/s (one
process) or 213 req/s (two) with the paced upstream, whatever its CPU.

Change the load with `BENCH_RAW_VUS` (default 300) and `BENCH_MIXED_VUS` (default 1800).

## Custom runs

```sh
bun run perf:k6:run                                  # smoke, mixed
PROFILE=load SCENARIO=all bun run perf:k6:run
bun run perf:k6:limit                                # steps up VUs until a step fails
```

Docker is the only requirement. The script exits non-zero when a threshold is
breached, prints the k6 summary, writes `results/summary.json` (gitignored),
reports whether the backend was OOM-killed, and removes the stack afterwards.

| Variable                | Values                                                                                    | Default |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------- |
| `TOPOLOGY`              | `dual`, `single`, `cluster` (see "Benchmark")                                             | `dual`  |
| `PROFILE`               | `smoke` (30 s), `load` (about 4.5 min), `stress` (about 5.5 min, steps up)                | `smoke` |
| `SCENARIO`              | `raw`, `mixed`, `edge`, `upstream`, `all` (mixed + edge + upstream), or one scenario name | `mixed` |
| `UPSTREAM_LATENCY_MS`   | paced upstream: wait before the first token                                               | `200`   |
| `TOKENS_PER_SECOND`     | paced upstream: stream speed                                                              | `100`   |
| `OUTPUT_TOKENS`         | paced upstream: tokens per answer                                                         | `200`   |
| `INSTANT_OUTPUT_TOKENS` | instant upstream: tokens per answer                                                       | `20`    |

## Scenarios

**`raw`**: `raw-chat`, `raw-chat-stream`, `raw-messages`, `raw-responses`, split
40/30/15/15, sent at a fixed rate (load: 500 req/s, stress: 500 up to 8000 req/s
in steps). k6 adds VUs as needed (`dropped_iterations` counts requests it
could not start in time, which means the limit is the gateway or k6 itself).

**`mixed`**: `chat`, `chat-stream`, `messages`, `responses` through the paced
upstream, same split, at 300 VUs in the load profile.

**`edge`**: each must be served or refused cleanly, with no 5xx, crash or
out-of-memory kill.

| Scenario              | What it sends                                                 | Expected         |
| --------------------- | ------------------------------------------------------------- | ---------------- |
| `huge-context`        | ~900K-token prompt (3.6 MB) to a 1M-context Model             | 200              |
| `huge-context-stream` | the same, streamed                                            | 200, full stream |
| `over-context`        | ~1.2M-token prompt to a 128K-context Model                    | 4xx, fast        |
| `oversize-body`       | 1 MB over the gateway body limit (20 MB)                      | 413              |
| `long-conversation`   | 4001 messages                                                 | 200              |
| `long-stream`         | the upstream streams 2000 tokens at 5 ms each                 | 200, full stream |
| `slow-upstream`       | the upstream waits 10 s, with many requests held open at once | 200              |

The gateway counts one token per four characters, so "900K tokens" is 3.6 million
characters.

**`upstream`**: the upstream misbehaves. `fault-*` has one Route, so the client must
get a clean error in time. `failover-*` has a healthy backup Route behind the
broken one, so the client must still get its answer.

| Fault       | The upstream                                | `fault-*` expects | `failover-*` expects |
| ----------- | ------------------------------------------- | ----------------- | -------------------- |
| `5xx`       | always answers 503                          | 4xx/5xx           | 200                  |
| `429`       | always answers 429 with `Retry-After`       | 4xx/5xx           | 200                  |
| `timeout`   | never answers (Route times out after 5 s)   | 4xx/5xx           | 200                  |
| `reset`     | drops the connection                        | 4xx/5xx           | 200                  |
| `flap`      | fails 3 calls in 10, deterministically      | any answer        | 200                  |
| `malformed` | answers 200 with a body that is not valid   | 4xx/5xx           | (none)               |
| `midstream` | streams 5 tokens, then drops the connection | the call ends     | (none)               |

The edge and upstream scenarios use a few VUs each (smoke 1, load as listed in
`scripts/gateway.js`, stress 3x), apart from the mixed ramp.

## Thresholds

Per profile, in `scripts/gateway.js`: the failed-request rate (a status outside
the scenario's expected range counts as failed), the check rate (status and a
complete answer) and each scenario's p95. Mixed limits follow the paced
upstream's answer time; raw limits are 300 ms (smoke), 500 ms (load). The
`stress` profile is meant to break the gateway, so its limits are loose and a
breach tells you where, not that the setup is wrong.

## Reading the results

- k6 and the fake upstream run on the same machine. If the host is short of
  CPUs, one of them becomes the bottleneck before the gateway does. Check
  `docker stats` during a stress run.
- The cap on the other services (2 + 1 + 1 + 0.5 CPUs) plus k6 and the fake
  upstream is more than a 4-CPU Docker VM has, so absolute numbers vary by about
  20% between runs on a laptop. Use a Linux host with 8+ CPUs for a clean figure.
- A fixed-rate (raw) run that shows `dropped_iterations` has hit a limit.
  A fixed-VU run (mixed) cannot: its req/s is about VUs divided by latency.

## Baseline

Measured on Docker Desktop on macOS (Apple M3 Pro; Docker VM with 4 CPUs and
about 7.6 GB), gateway capped at 2 CPUs / 2 GB.

**Gateway alone** (`PROFILE=load SCENARIO=raw`, 500 req/s held for 3 min):
104,869 requests, 0% failed, **p95 3.9 ms**, p99 58 ms, max 365 ms, 128 dropped
iterations, no OOM kill. The gateway takes this rate with room to spare.

`PROFILE=stress SCENARIO=raw` (500 up to 8000 req/s) broke it: 209,153 requests
completed (an average of 622 req/s) and 600,845 iterations were dropped. The
median stayed at 123 ms while p95 climbed to 21.7 s, with 0.01% failed requests
and no OOM kill. The run does not show per-step results, so the exact ceiling
between 500 and a few thousand req/s is still open. Narrow it with `load` runs
at fixed rates, ideally on a bigger host so k6 itself is not the limit.

**End to end** (`PROFILE=load SCENARIO=all`, 145 VUs at peak, the earlier
version of the mixed traffic with a 200 ms upstream): 44,751 to 54,821 requests
in 4.5 min across two runs, 0% failed, no OOM kill. The 900K-token requests were
served at p95 of 654 ms (non-stream) and 998 ms (stream).

**Upstream faults** (`PROFILE=smoke SCENARIO=upstream`): every `failover-*`
scenario returned 200 for every request. A broken first Route only costs the
first request (p95 about 2.3 s with an immediate failure, about 7.3 s for a
hung upstream, which waits for the Route's 5 s total timeout); after that the
gateway skips the failing account. Every `fault-*` scenario returned an error
in time, with no hang and no crash.
