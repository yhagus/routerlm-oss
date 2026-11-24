import { sql } from "drizzle-orm";
import type { Transaction } from "@/db/schemas/relations.js";
import { users } from "@/db/schemas/index.js";

export async function lockUsers(tx: Transaction): Promise<void> {
  await tx.execute(sql`lock table ${users} in share row exclusive mode`);
}
