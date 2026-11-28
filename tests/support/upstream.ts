import type { INestApplicationContext } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { models, routes } from '@/db/schemas';
import { truncateTables } from './truncate';

export async function deleteAllUpstreamData(
  app: INestApplicationContext,
  ...otherApps: INestApplicationContext[]
): Promise<void> {
  await truncateTables(
    app,
    sql.raw('users, models, model_groups, routes, providers, usage_logs'),
    ...otherApps,
  );
}

export async function insertRouteTo(
  db: Database,
  upstreamModelId: string,
  modelName: string,
): Promise<void> {
  const [model] = await db.insert(models).values({ name: modelName }).returning({ id: models.id });
  await db.insert(routes).values({ modelId: model.id, upstreamModelId });
}
