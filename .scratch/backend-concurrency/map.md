Labels: wayfinder:map

# Backend concurrency on minimal hardware

## Destination

A ranked optimization spec for the backend. Each change has measured evidence and a decision. The spec is ready to hand to implementation sessions.

## Notes

- Domain: the Bun + Hono backend in `backend/src/`. The frontend is out of this effort.
- Target load: 2,000 concurrent in-flight streams and 100 new requests per second.
- Target overhead: router TTFB overhead p99 below 50 ms. Router overhead excludes upstream latency.
- Reference hardware: 2 vCPU and 2 GB RAM.
- Primary workload: streaming chat (`/v1/chat/completions`, `/v1/messages`, `/responses`). Media endpoints are secondary.
- Topology limit: one node and SQLite. Do not add Redis or Postgres. Multiple processes on one machine are an open option.
- Reference deploy: PM2 (`ecosystem.config.cjs`). Align Docker after the spec is done.
- Expensive features may become optional through config. Default behavior stays the same. A "high-concurrency" profile may turn them off.
- Overload policy: reject fast with `503` and `Retry-After` when a global in-flight cap is reached. Do not queue.
- Usage and log writes may be batched in memory. Flush about every second and on graceful shutdown. A crash may lose about one second of usage.
- In multi-process mode, per-key rate and concurrency limits may be approximate.
- Evidence rule: every spec item needs numbers from the load-test harness.
- Plan, do not do: tickets produce decisions, not optimizations. The harness task is the only build work.
- Write tickets in ASD-STE100 Simplified Technical English (see `AGENTS.md`).

## Decisions so far

## Not yet specified

## Out of scope
