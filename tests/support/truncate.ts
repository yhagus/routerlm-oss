import type { INestApplicationContext } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { BackgroundWork } from '@/libs/providers/background-work';

export async function settleBackgroundWork(...apps: INestApplicationContext[]): Promise<void> {
  for (const app of apps) {
    await app.get(BackgroundWork).settle();
  }
}

export async function truncateTables(
  app: INestApplicationContext,
  tables: SQL,
  ...otherApps: INestApplicationContext[]
): Promise<void> {
  await settleBackgroundWork(app, ...otherApps);
  await app.get<Database>(getDrizzleToken()).execute(sql`truncate table ${tables} cascade`);
}
