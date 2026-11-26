---
status: accepted
areas: [inference]
---
# Request Rate counting fails open when Redis is down and never blocks past its window

`CallerLimits` in `src/inference/providers/caller-limits.ts` counts an API Key's requests in the throttler's Redis storage (ADR 0021), shared by every gateway process. We decided that while Redis is down nothing is counted and the request goes through, as login does, because refusing all inference for an outage is worse than letting a Request Rate lapse. A key is refused only while it is over its rate in the current window, with no extra blocking window afterwards (`NO_BLOCK`), and the rate is part of the storage key so a changed Request Rate starts a fresh count at once.
