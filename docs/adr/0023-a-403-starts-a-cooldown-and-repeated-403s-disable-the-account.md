---
status: accepted
areas: [upstream, inference]
---
# A 403 starts a Cooldown, and repeated 403s disable the Provider Account

Any upstream 401 or 403 disabled the shared Provider Account until an operator re-enabled it. A Provider that answers 403 for a reason tied to one request (content policy, model entitlement) would let one API Key holder take an account offline for every other client. We decided:

- A 401 still disables the account at once: the credential itself is rejected.
- A 403 starts a Cooldown like a 5xx. The third consecutive 403 on the same account, with no successful Attempt in between, disables it. A success resets the count.
- Fallback to the next account already happens after every failed Attempt and is unchanged. 5xx, timeouts and connection errors keep their Cooldown.

## Considered Options

- Disabling on the first 403 (the previous behavior). Rejected: one request-specific refusal costs every client the account.
- Never disabling on 403. Rejected: a revoked or banned key would be retried forever, with a Cooldown at most.
- Telling request-specific 403s apart by reading the response body. Rejected: bodies differ per Provider and would need per-Provider code (ADR 0003).

## Consequences

- A genuinely revoked key returning 403 takes three failed Attempts to be disabled instead of one.
- The consecutive-403 count needs shared state, kept where the Cooldown already lives.
- The disabled reason shown on the dashboard says the account was disabled after repeated refusals.
