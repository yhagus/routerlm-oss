import type { NestNodeApplication } from '@nestjs/platform-node';
import type { Database } from '@/db/schemas/relations';
import { modelGroupMembers, modelGroups } from '@/db/schemas';
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
