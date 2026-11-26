---
status: accepted
areas: [control-plane, usage]
---
# Integrations pull Usage Logs after a (transaction id, sequence) cursor, only past finished transactions

An Integration pulls its Usage Logs in pages after a cursor. `created_at` cannot be the cursor, because it is the request time while the worker commits rows later, so a late commit would land behind a cursor that had already moved on.

We decided that each Usage Log stores the PostgreSQL transaction id that wrote it (`xid8`, read as a decimal string because it does not fit a JS number) and the order it was inserted in, and the cursor is that pair. Only rows of transactions older than every transaction still running are pulled, so a row committed late can never appear behind the cursor. See the columns in `src/db/schemas/records.ts` and the index for the usage pull.
