---
status: accepted
areas: [control-plane]
---
# An Integration's API Keys are paged by created_at and id, compared in SQL

The control plane lists an Integration's keys newest first, in pages with an opaque page token.

We decided on the order `created_at` descending, then `id` (`NEWEST_KEYS_FIRST` in `src/control-plane/models/customer-api-keys.ts`), so ties page stably, and that the token holds only the last key's id. `olderThan` in `list-customer-api-keys.handler.ts` compares the row pair against that key's own row in SQL, because `created_at` holds microseconds that a JavaScript `Date` rounds to milliseconds, which would skip or repeat keys at a page edge.

## Consequences

- Passing the last key's `createdAt` back from JavaScript is a bug even though it looks simpler.
