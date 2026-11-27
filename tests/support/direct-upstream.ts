import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { apiKeys, upstreamModels } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { ALL_CAPABILITIES } from './inference';

export async function grantDirectUpstreamAccess(
  app: NestNodeApplication,
  db: Database,
  apiKeyId: string,
): Promise<void> {
  await db.update(apiKeys).set({ directUpstreamAccess: true }).where(eq(apiKeys.id, apiKeyId));
  await app.get(SnapshotService).changed();
}

export async function insertUpstreamModel(
  app: NestNodeApplication,
  db: Database,
  providerId: string,
  upstreamModelId: string,
): Promise<string> {
  const [upstreamModel] = await db
    .insert(upstreamModels)
    .values({ providerId, upstreamModelId, capabilities: ALL_CAPABILITIES, contextSize: 128_000 })
    .returning({ id: upstreamModels.id });
  await app.get(SnapshotService).changed();
  return upstreamModel.id;
}
