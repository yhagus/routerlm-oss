import { desc, eq, max, type SQL } from 'drizzle-orm';
import { findModelGroupNames, findModelNames } from '@/libs/models/allowed-models';
import type { Database } from '@/db/schemas/relations';
import { integrationRotations, integrations, users } from '@/db/schemas';
import type { IntegrationSummary } from './integration';

export async function selectIntegrationSummaries(
  db: Database,
  where?: SQL,
): Promise<IntegrationSummary[]> {
  const lastRotations = db
    .select({
      integrationId: integrationRotations.integrationId,
      lastRotatedAt: max(integrationRotations.rotatedAt).as('last_rotated_at'),
    })
    .from(integrationRotations)
    .groupBy(integrationRotations.integrationId)
    .as('last_rotations');
  const rows = await db
    .select({
      id: integrations.id,
      name: integrations.name,
      keyId: integrations.keyId,
      creatorId: users.id,
      creatorEmail: users.email,
      createdAt: integrations.createdAt,
      disabledAt: integrations.disabledAt,
      allowedModelIds: integrations.allowedModelIds,
      allowedModelGroupIds: integrations.allowedModelGroupIds,
      directUpstreamAccess: integrations.directUpstreamAccess,
      lastRotatedAt: lastRotations.lastRotatedAt,
      lastUsedAt: integrations.lastUsedAt,
    })
    .from(integrations)
    .leftJoin(users, eq(integrations.createdById, users.id))
    .leftJoin(lastRotations, eq(lastRotations.integrationId, integrations.id))
    .where(where)
    .orderBy(desc(integrations.createdAt));
  const modelNames = await findModelNames(
    db,
    rows.flatMap((row) => row.allowedModelIds),
  );
  const modelGroupNames = await findModelGroupNames(
    db,
    rows.flatMap((row) => row.allowedModelGroupIds),
  );
  return rows.map(({ creatorId, creatorEmail, allowedModelIds, allowedModelGroupIds, ...row }) => ({
    ...row,
    createdBy: creatorId && creatorEmail ? { id: creatorId, email: creatorEmail } : null,
    allowedModels: allowedModelIds.map((id) => ({ id, name: modelNames.get(id) ?? null })),
    allowedModelGroups: allowedModelGroupIds.map((id) => ({
      id,
      name: modelGroupNames.get(id) ?? null,
    })),
  }));
}
