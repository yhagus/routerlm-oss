# What an API Key has spent is counted with its Usage Log, and Redis only holds a flag

A Spend Limit (ADR 0034) needs a running total of Cost per API Key, and the gateway processes need to check it on every request without slowing it down. Usage Logs are written by the queue worker, in one transaction that a retried job leaves alone (`UsageWriter.writeUsage`).

We decided that the API Key's `spent` column is incremented in that same transaction, so each request is counted exactly once and Postgres stays the source of truth. After the commit, the worker writes to Redis whether the key has reached its Spend Limit, and a gateway process checks that flag with one Redis read per request. Changing a Spend Limit recomputes the flag.

## Considered Options

- An atomic counter in Redis, incremented by the gateway process when a request finishes. Rejected: tighter, but it drifts from the Usage Logs when Redis loses data or a process dies between the request and the increment, and then it is unclear which total is right.
- Summing Usage Logs on each request. Rejected: a query on the hot path that grows with history.

## Consequences

- A key can go past its Spend Limit by the requests running when it is reached plus whatever is still in the queue, normally a few seconds' worth.
- When a key with a Spend Limit has no flag in Redis (Redis lost it, or it was never written), the gateway process reads `spent` and the limit from Postgres for that request and writes the flag back. A key over its limit is never let through for lack of a flag: protecting money is worth a database read on those requests.
