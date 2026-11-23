import { sql } from "drizzle-orm";
import type { Transaction } from "@/db/schemas/relations.js";
import { users } from "@/db/schemas/index.js";

/** Locks the `users` table for the rest of `tx`, so concurrent writers that count Users queue up. */
export async function lockUsers(tx: Transaction): Promise<void> {
  // SHARE ROW EXCLUSIVE conflicts with itself and with writes, but not with reads.
  await tx.execute(sql`lock table ${users} in share row exclusive mode`);
}
