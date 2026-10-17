# 07: Per-Connection in-flight limit

**What to build:** An operator sets a maximum number of in-flight requests per Connection for a Provider in the dashboard. Selection skips a Connection at its limit. When every eligible Connection is full, the client gets a fast 503 with `Retry-After`. The default is no limit, so current behavior stays the same.

**Blocked by:** 05 (Round-robin rotates across Connections)

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md` (Connection selection, Admission control).

- [ ] A per-Provider setting stores the maximum in-flight requests per Connection. The default is no limit.
- [ ] The provider settings view in the dashboard shows and saves the setting.
- [ ] Selection reads the in-flight count from the existing pending-request tracking and skips a full Connection. Fill-first picks the first Connection with free capacity. Round-robin treats a full Connection as not eligible.
- [ ] The in-flight slot is taken before the first `await` after selection.
- [ ] The slot returns when a non-stream response ends, when a stream ends, on an upstream error, and when the client disconnects.
- [ ] When every eligible Connection is full, the response is 503 with `Retry-After`, in the existing gateway error format, without the Provider name or pool details.
- [ ] Test (HTTP seam): limit 1, two Connections, held mock responses. Request 2 goes to the second Connection. Request 3 gets 503 with `Retry-After`.
- [ ] Test (HTTP seam): after the client aborts a held stream, a new request gets that slot.

## Comments

Implementer note: the setting is `settings.providerStrategies[provider].maxInFlightPerConnection` (positive integer; missing or 0 means no limit). Selection reads an exact per-Connection count kept by `services/chat/connectionSlots.ts`. The slot also calls `repos.usage.pendingStart/pendingEnd`, so the dashboard tracking is unchanged. The count is separate because pending tracking drops an entry after 60s, which would let a long stream stop counting against the limit. `Retry-After` is 1 second. The legacy `createGateway` fallback path and the native Gemini route do not take slots.

Orchestrator: accepted the exact per-Connection slot counter instead of pending tracking (pending entries expire after 60s). Legacy gateway fallback and native Gemini route do not take slots yet; moved to ticket 08.
