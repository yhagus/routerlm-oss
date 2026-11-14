import { sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { users } from "@/db/schemas/index.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Locks the `users` table for the rest of `tx`, so concurrent writers that count Users queue up. */
export async function lockUsers(tx: Transaction): Promise<void> {
  // SHARE ROW EXCLUSIVE conflicts with itself and with writes, but not with reads.
  await tx.execute(sql`lock table ${users} in share row exclusive mode`);
}
