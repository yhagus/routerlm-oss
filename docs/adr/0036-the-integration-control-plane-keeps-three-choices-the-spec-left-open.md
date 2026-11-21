# The Integration control plane orders usage by commit, refuses changes to revoked keys, and prices Models from the first Route that can serve

Three details of the control plane (ADR 0033) were left open by the spec, or settled differently from its wording, while it was built.

## The usage pull orders by transaction, then sequence

The spec asked for a cursor that follows the sequence a Usage Log gets on insert, with a guard so that a page never returns a sequence while a smaller one may still commit. A sequence number is taken when a row is inserted, not when its transaction commits, so no guard makes "sequence order" and "never skip a row" hold together: a page that waited for every smaller sequence could still be overtaken by a slow transaction holding one.

We decided that each Usage Log also records the id of the transaction that wrote it (`transaction_id`, `xid8`), and that the pull orders by transaction id, then sequence. A page returns only rows whose transaction id is older than the oldest transaction still running (`pg_snapshot_xmin(pg_current_snapshot())`). Every row the cursor passes over is committed, and no row can later appear behind it. The cursor carries both values and stays opaque to the Integration.

Consequences: no Usage Log is skipped or returned twice. Rows come back in commit order, not strictly in sequence order. While any write transaction on the Postgres server is open, even in another database, pulls return nothing newer than it; a long transaction delays usage, it never loses it.

## Updating or rotating a revoked key is refused as a failed precondition

The spec names three errors (unauthenticated, not found, invalid argument). Updating or rotating a key the Integration already revoked is none of them: the key exists and belongs to the caller, and the request is well formed. It answers `409` over HTTP and `FAILED_PRECONDITION` over gRPC, mapped one-to-one like the other three.

## A Model's prices come from the first Route that can serve it

The spec says a listed Model carries "the prices of the first Route's Upstream Model". A first Route whose Upstream Model or Provider is disabled can't serve, and its prices are not what a Customer pays. The list uses the first Route that can serve, in Route order, and merges Capabilities across all Routes that can serve, as `GET /v1/models` does for Customers.
