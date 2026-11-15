import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { hasPostgresErrorCode } from "@/libs/models/postgres-errors.js";

const DEADLOCK_DETECTED = "40P01";
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 50;

/**
 * Truncates `tables`, retrying when PostgreSQL picks the truncate as a deadlock
 * victim. A previous test's background work (an Exhausted Attempt starts a
 * quota reading nobody awaits) can still hold row locks on these tables, and
 * no request a test makes can wait for that work to end.
 */
export async function truncateTables(db: Database, tables: SQL): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await db.execute(sql`truncate table ${tables} cascade`);
      return;
    } catch (error) {
      if (attempt === ATTEMPTS || !hasPostgresErrorCode(error, DEADLOCK_DETECTED)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
