import { ConflictException } from '@nestjs/common';
import { asc, eq, type SQL } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { FOREIGN_KEY_VIOLATION, hasPostgresErrorCode } from '@/libs/models/postgres-errors';
import { models, routes, upstreamModels } from '@/db/schemas';

async function findModelsRoutingTo(
  db: Database,
  upstreamModelFilter: SQL | undefined,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ name: models.name })
    .from(routes)
    .innerJoin(models, eq(routes.modelId, models.id))
    .innerJoin(upstreamModels, eq(routes.upstreamModelId, upstreamModels.id))
    .where(upstreamModelFilter)
    .orderBy(asc(models.name));
  return rows.map((row) => row.name);
}

export async function deleteUnlessRouted(
  db: Database,
  what: string,
  upstreamModelFilter: SQL | undefined,
  deleteIt: () => Promise<void>,
): Promise<void> {
  const routedModels = await findModelsRoutingTo(db, upstreamModelFilter);
  if (routedModels.length > 0) {
    throw new ConflictException(
      `${what} is used by Routes of these Models: ${routedModels.join(', ')}. Remove those Routes first.`,
    );
  }
  try {
    await deleteIt();
  } catch (error) {
    if (hasPostgresErrorCode(error, FOREIGN_KEY_VIOLATION)) {
      throw new ConflictException(`${what} is used by a Route. Remove that Route first.`);
    }
    throw error;
  }
}
