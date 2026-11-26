import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { hasPostgresErrorCode } from '@/libs/models/postgres-errors';

const DEADLOCK_DETECTED = '40P01';
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 50;

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
