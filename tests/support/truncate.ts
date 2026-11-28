import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { settleBackgroundWork } from '@/libs/models/background-work';

export async function truncateTables(db: Database, tables: SQL): Promise<void> {
  await settleBackgroundWork();
  await db.execute(sql`truncate table ${tables} cascade`);
}
