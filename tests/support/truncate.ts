import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { settleQuotaReadings } from './quota-readings';

export async function truncateTables(db: Database, tables: SQL): Promise<void> {
  await settleQuotaReadings();
  await db.execute(sql`truncate table ${tables} cascade`);
}
