import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { apiKeys, modelGroupMembers, modelGroups } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';

export async function insertModelGroup(
  app: NestNodeApplication,
  db: Database,
  slug: string,
  modelIds: string[] = [],
): Promise<string> {
  const [group] = await db
    .insert(modelGroups)
    .values({ name: `${slug} group`, slug })
    .returning({ id: modelGroups.id });
  if (modelIds.length > 0) {
    await db
      .insert(modelGroupMembers)
      .values(modelIds.map((modelId) => ({ modelId, modelGroupId: group.id })));
  }
  await app.get(SnapshotService).changed();
  return group.id;
}

export async function allowApiKeyModelGroups(
  app: NestNodeApplication,
  db: Database,
  apiKeyId: string,
  modelGroupIds: string[],
): Promise<void> {
  await db
    .update(apiKeys)
    .set({ allowedModelGroupIds: modelGroupIds })
    .where(eq(apiKeys.id, apiKeyId));
  await app.get(SnapshotService).changed();
}

export async function addModelToGroup(
  app: NestNodeApplication,
  db: Database,
  modelId: string,
  modelGroupId: string,
): Promise<void> {
  await db.insert(modelGroupMembers).values({ modelId, modelGroupId });
  await app.get(SnapshotService).changed();
}

export async function deleteModelGroup(
  app: NestNodeApplication,
  db: Database,
  modelGroupId: string,
): Promise<void> {
  await db.delete(modelGroups).where(eq(modelGroups.id, modelGroupId));
  await app.get(SnapshotService).changed();
}
