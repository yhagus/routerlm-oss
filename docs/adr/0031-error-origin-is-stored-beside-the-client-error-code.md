# Error Origin is stored beside the client error code, not derived from it

Status: accepted

The Overview's error rate mixed every failed request together, so an operator couldn't tell a client's bad API Key from a Provider outage or a gateway bug. We decided that each failed Usage Log stores its Error Origin (Client, Upstream or Gateway) in its own column, set when the request is recorded by the code that knows the cause. The client-facing error code stays exactly as the error contract defines it.

## Considered options

- Derive the origin from `errorCode` at query time. Rejected: one code can have two origins. An upstream 400 reaches the client as `invalid_request`, the same code as a body the gateway itself couldn't parse. A gateway bug has no code at all, only status 500.
- Add origin-specific client error codes (for example `upstream_invalid_request`). Rejected: it changes the public error contract, and it tells callers more about which Provider refused them than they need.

## Consequences

- The label says where to look, not who to blame. An upstream 400 is Upstream even when the client's content caused it, and so is a request refused because every Provider Account was in Cooldown, though no Attempt was made. The Error Capture shows the real cause.
- The migration backfills existing rows exactly: `upstream_*` codes, and `invalid_request` with at least one Attempt, are Upstream. Status 500 with no code is Gateway. Every other code is Client.
- A cancelled or successful request has no Error Origin.
- It covers requests only. An Attempt that failed while Fallback went on to answer the request has a failure reason, not an Error Origin.
