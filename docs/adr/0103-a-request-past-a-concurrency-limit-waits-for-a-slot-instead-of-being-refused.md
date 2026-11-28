---
status: accepted
areas: [inference, api-keys, upstream]
---
# A request past a Concurrency Limit waits for a slot instead of being refused

API Keys and Provider Accounts can each have a Concurrency Limit, counted across every backend process and replica. We decided that a request past a limit waits for a slot, first come first served, instead of getting a 429. A Provider Account only has capacity for so many requests at once, and a client handles a slower response better than a refusal it has to retry. The wait has one budget for the whole request, set gateway-wide (60 seconds by default). A request still waiting when that budget runs out is refused with 429 and `Retry-After`. Nothing is sent to the client while it waits, not even SSE headers, so that refusal is always a real status code.

This amends ADR 0044. A Provider Account at its limit is passed over like one in Cooldown, and a request waits only when every Provider Account that could serve it is full. It then takes the first slot that frees on any of them. Waiting for the first account would keep a conversation's prompt cache together, but other accounts would sit idle while requests queue.

Like Request Rate (ADR 0051, ADR 0058), the limits let requests through while Redis is unreachable: nothing waits and nothing is refused. Each slot is a lease that its process renews while the request is in flight. A crashed or redeployed process loses its slots about 30 seconds later, and for that window the gateway counts fewer free slots than there really are. A waiting request's place in line lapses about 3 seconds after its process stops renewing it, so a dead waiter can't block the head of a line for long.

## Consequences

- Requests from one conversation can land on different Provider Accounts once the first one is full, and they lose the prompt cache when they do.
- Playground requests and Direct Upstream Model tests take Provider Account slots like client requests. Quota Meter reads and OAuth refreshes do not.
- The Usage Log records time spent waiting for slots separately from upstream latency, and a request refused after waiting too long gets an Error Capture.
