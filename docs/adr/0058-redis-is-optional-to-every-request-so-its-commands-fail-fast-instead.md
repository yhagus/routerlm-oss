---
status: accepted
areas: [redis, queue, upstream]
---
# Redis is optional to every request, so its commands fail fast instead of waiting

Redis holds Cooldown state, snapshot change notices, locks and the BullMQ queues, but a request must never hang or fail because Redis is unreachable.

We decided that the backend's connections fail at once while Redis is down instead of queueing commands (`RedisConnection`, with a 250 ms command timeout past which Redis state is treated as unknown), that the backend's BullMQ producer connection in `QueueModule` is configured so `queue.add` rejects after one failed reconnect (about a second) instead of waiting forever, and that `addJobOrLog` logs and returns undefined rather than throwing. Callers degrade: `CooldownStore.countRefusal` returns 0, so a Redis outage never disables a Provider Account. The worker is the opposite on purpose: `WorkerModule` keeps BullMQ's defaults so workers wait and reconnect while Redis is down. Sign-in is the exception, because it cannot work without Redis; it throws ServiceUnavailableException.

## Consequences

- A Redis outage costs at most a failed Attempt and a Fallback, or a dropped usage job, never the request.
