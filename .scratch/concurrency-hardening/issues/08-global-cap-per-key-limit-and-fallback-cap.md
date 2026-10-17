# 08: Global cap, per-API-key concurrency limit, and Fallback cap

**What to build:** During a spike, LobakAI rejects fast instead of running out of memory or trying every Connection. A global in-flight cap returns 503. An operator sets a concurrency limit per API key in the dashboard, and that key gets 429 when it is full. One request tries at most a set number of Connections.

**Blocked by:** 07 (Per-Connection in-flight limit)

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md` (Admission control).

- [ ] A global in-flight cap applies to chat and media routes. When full, the response is 503 with `Retry-After`. No queue.
- [ ] An API key setting stores a concurrency limit. The API key view in the dashboard shows and saves it. The default is no limit.
- [ ] When an API key is at its limit, the response is 429 with `Retry-After`. The existing requests-per-second and requests-per-minute limiter still works.
- [ ] Global and per-key slots return when a response ends, a stream ends, on error, and on client disconnect.
- [ ] A Fallback cap limits the number of Connections one request tries. Record the chosen default and the reason under `## Comments`.
- [ ] Test (HTTP seam): global cap 2 with held responses. Request 3 gets 503 with `Retry-After`.
- [ ] Test (HTTP seam): key limit 1 with a held response. A second request with the same key gets 429. A request with another key succeeds.
- [ ] Test (HTTP seam): Fallback cap 2 with five failing Connections. The mock receives exactly two upstream attempts.
- [ ] Harness: a run above the global cap shows fast 503 responses and stable RSS. Record numbers under `## Comments`.

## Comments

Implementer note (settings and defaults):

- Global cap: `settings.maxInFlightRequests`. Default 2500. `0` turns the cap off. The reason: the map target is 2,000 concurrent streams. 2500 keeps 25% headroom above the target, so ticket 12 can reach the target. The cap still stops an unbounded spike before memory runs out.
- Fallback cap: `settings.maxFallbackConnections`. Default 5. `0` turns the cap off. The reason: a failed Connection gets a cooldown, so the next request skips it. Five attempts cover usual transient failures. Five attempts also stop one request from trying every Connection in a large pool during a spike.
- Per-key limit: the existing `apiKeys.maxConcurrency` column. Missing or 0 means no limit. The dashboard already saved it in the API key limit dialog. The key list row now also shows "Max N concurrent".
- Rejections use `gatewayBusyResponse`: 503 for the global cap, 429 for the key limit. Both send `Retry-After: 1`. The per-key check runs first.
- One counter: `services/chat/connectionSlots.ts` now counts three scopes (`connection`, `apiKey`, `global`), keyed by the Repositories object. The old process-global `services/platform/concurrency.ts` is deleted. It leaked a slot for every media request, because only chat routes released it.
- Admission runs in `services/chat/admission.ts` (`withAdmission`). It covers all `/v1` chat and media POST routes, `/v1/responses/compact`, the `/v1beta` Gemini routes, and the dashboard playground chat. `GET /v1/videos/:id` (status poll) is not admitted.
- Ticket 07 scope addition: the legacy `createGateway` path and the native Gemini forward now take Connection slots, skip full Connections, and apply the Fallback cap.
- Combos: a busy member response (it has `Retry-After`) no longer causes the 2 s transient wait. When every member fails, the combo response keeps `Retry-After`.

Harness (local macOS, Bun 1.4.0, 1 Connection, 200 chunks x 50 ms per stream, about 10 s per stream). New option `--max-in-flight <n>` sets `maxInFlightRequests`. The report now shows non-200 latency.

| Run | Cap | Offered | 200 / 503 | 503 latency p50 / p99 | Peak in-flight at mock | Peak RSS | Loop lag p99 |
|---|---|---|---|---|---|---|---|
| A | 100 | 40 rps, up to 400 streams | 200 / 600 | 0.6 / 4.4 ms | 100 | 111 MB | 5.1 ms |
| B | 100 | 120 rps, up to 1200 streams | 200 / 2200 | 0.3 / 2.5 ms | 100 | 119 MB | 2.1 ms |
| C | off | 40 rps, up to 400 streams (`--server-max-http 1000`) | 789 / 0 | n/a | 400 | 177 MB | 5.3 ms |

Result: above the cap, LobakAI rejects in under 5 ms at p99. The upstream never sees more than the cap. RSS stays near 111-119 MB when the offered load triples (A to B). Without the cap (C), RSS grows with the stream count. No stream lost `[DONE]`.

Orchestrator: accepted, including the combo Retry-After change. Follow-ups outside this spec: (1) per-key rps/rpm window is charged before admission, so rejected requests count; (2) `/v1/responses/compact` has no API key check (pre-existing).
