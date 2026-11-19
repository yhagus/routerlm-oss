import { desc, eq, inArray, max, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeyRotations, apiKeys, models, users } from "@/db/schemas/index.js";
import type { ApiKeySummary } from "./api-key.js";

/** API Key summaries, newest first, optionally narrowed by `where`. */
export async function selectApiKeySummaries(db: Database, where?: SQL): Promise<ApiKeySummary[]> {
  const lastRotations = db
    .select({
      apiKeyId: apiKeyRotations.apiKeyId,
      lastRotatedAt: max(apiKeyRotations.rotatedAt).as("last_rotated_at"),
    })
    .from(apiKeyRotations)
    .groupBy(apiKeyRotations.apiKeyId)
    .as("last_rotations");
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
      isCopyable: sql<boolean>`${apiKeys.encryptedKey} is not null`,
      lastRotatedAt: lastRotations.lastRotatedAt,
    })
    .from(apiKeys)
    .leftJoin(users, eq(apiKeys.createdById, users.id))
    .leftJoin(lastRotations, eq(lastRotations.apiKeyId, apiKeys.id))
    .where(where)
    .orderBy(desc(apiKeys.createdAt));
  const modelNames = await findModelNames(
    db,
    rows.flatMap((row) => row.allowedModelIds),
  );
  return rows.map(({ creatorId, creatorEmail, allowedModelIds, ...row }) => ({
    ...row,
    createdBy: creatorId && creatorEmail ? { id: creatorId, email: creatorEmail } : null,
    allowedModels: allowedModelIds.map((id) => ({ id, name: modelNames.get(id) ?? null })),
  }));
}

async function findModelNames(db: Database, modelIds: string[]): Promise<Map<string, string>> {
  if (modelIds.length === 0) {
    return new Map();
  }
  const found = await db
    .select({ id: models.id, name: models.name })
    .from(models)
    .where(inArray(models.id, [...new Set(modelIds)]));
  return new Map(found.map((model) => [model.id, model.name]));
}
