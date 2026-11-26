---
status: accepted
areas: [inference]
---
# The HTTP client never retries an upstream call; Fallback is the only retry

`HttpClientModule` is registered in `src/inference/inference.module.ts` with `retry: false`, and `UpstreamClient` and `MediaUpstreamClient` make one call per Attempt. Fallback across Provider Accounts and Routes is the gateway's job, with its own rules for Cooldown, Exhausted and disabling accounts. A hidden client retry would repeat a request the Fallback table meant to move on, count Attempts wrongly and blur the Usage Log.

We decided that no layer below the Attempt retries.
