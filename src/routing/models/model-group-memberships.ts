import { asc, eq, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '@/db/schemas/relations';
import { modelGroupMembers, modelGroups } from '@/db/schemas';
import type { ModelGroupRef } from './model';

export async function replaceModelGroups(
  transaction: Transaction,
  modelId: string,
  groupIds: string[],
): Promise<void> {
  await transaction.delete(modelGroupMembers).where(eq(modelGroupMembers.modelId, modelId));
  await transaction
    .insert(modelGroupMembers)
    .values(groupIds.map((modelGroupId) => ({ modelId, modelGroupId })));
}

export async function findModelGroups(db: Database, modelId: string): Promise<ModelGroupRef[]> {
  const groupsByModelId = await findGroupsByModelId(db, eq(modelGroupMembers.modelId, modelId));
  return groupsByModelId.get(modelId) ?? [];
}

export async function findGroupsByModelId(
  db: Database,
  membershipFilter?: SQL,
): Promise<Map<string, ModelGroupRef[]>> {
  const rows = await db
    .select({
      modelId: modelGroupMembers.modelId,
      id: modelGroups.id,
      name: modelGroups.name,
      slug: modelGroups.slug,
    })
    .from(modelGroupMembers)
    .innerJoin(modelGroups, eq(modelGroupMembers.modelGroupId, modelGroups.id))
    .where(membershipFilter)
    .orderBy(asc(modelGroups.name));
  const groupsByModelId = new Map<string, ModelGroupRef[]>();
  for (const { modelId, ...group } of rows) {
    groupsByModelId.set(modelId, [...(groupsByModelId.get(modelId) ?? []), group]);
  }
  return groupsByModelId;
}
