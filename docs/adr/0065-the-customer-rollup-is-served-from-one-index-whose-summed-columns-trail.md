# The Customer rollup is served from one index whose summed columns trail as key columns

The Integration page groups an Integration's Usage Logs by Customer. We decided that one index on `usage_logs` answers that rollup alone, so it never reads the table. Drizzle has no `INCLUDE`, so the summed and compared columns trail as ordinary key columns of the index in `src/db/schemas/records.ts`. Removing those trailing columns, or turning the index into a plain one, makes the rollup read the table again.
