import { desc, eq, max, type SQL, sql } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { apiKeyRotations, apiKeys, integrations, users } from '@/db/schemas';
import { findModelGroupNames, findModelNames } from '@/libs/models/allowed-models';
import type { ApiKeySummary } from './api-key';

export async function selectApiKeySummaries(db: Database, where?: SQL): Promise<ApiKeySummary[]> {
  const lastRotations = db
    .select({
      apiKeyId: apiKeyRotations.apiKeyId,
      lastRotatedAt: max(apiKeyRotations.rotatedAt).as('last_rotated_at'),
    })
    .from(apiKeyRotations)
    .groupBy(apiKeyRotations.apiKeyId)
    .as('last_rotations');
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyId: apiKeys.keyId,
      creatorId: users.id,
      creatorEmail: users.email,
      createdAt: apiKeys.createdAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      allowedModelIds: apiKeys.allowedModelIds,
      allowedModelGroupIds: apiKeys.allowedModelGroupIds,
      directUpstreamAccess: apiKeys.directUpstreamAccess,
      isCopyable: sql<boolean>`${apiKeys.encryptedKey} is not null`,
      lastRotatedAt: lastRotations.lastRotatedAt,
      integrationId: integrations.id,
      integrationName: integrations.name,
      customerId: apiKeys.customerId,
      spendLimit: apiKeys.spendLimit,
      spent: apiKeys.spent,
      requestRate: apiKeys.requestRate,
    })
    .from(apiKeys)
    .leftJoin(users, eq(apiKeys.createdById, users.id))
    .leftJoin(lastRotations, eq(lastRotations.apiKeyId, apiKeys.id))
    .leftJoin(integrations, eq(apiKeys.integrationId, integrations.id))
    .where(where)
    .orderBy(desc(apiKeys.createdAt));
  const modelNames = await findModelNames(
    db,
    rows.flatMap((row) => row.allowedModelIds),
  );
  const modelGroupNames = await findModelGroupNames(
    db,
    rows.flatMap((row) => row.allowedModelGroupIds),
  );
  return rows.map(
    ({
      creatorId,
      creatorEmail,
      allowedModelIds,
      allowedModelGroupIds,
      integrationId,
      integrationName,
      ...row
    }) => ({
      ...row,
      createdBy: creatorId && creatorEmail ? { id: creatorId, email: creatorEmail } : null,
      integration:
        integrationId && integrationName ? { id: integrationId, name: integrationName } : null,
      allowedModels: allowedModelIds.map((id) => ({ id, name: modelNames.get(id) ?? null })),
      allowedModelGroups: allowedModelGroupIds.map((id) => ({
        id,
        name: modelGroupNames.get(id) ?? null,
      })),
    }),
  );
}
