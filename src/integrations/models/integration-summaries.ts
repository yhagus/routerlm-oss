import { desc, eq, max, type SQL } from "drizzle-orm";
import { findModelNames } from "@/libs/models/allowed-models.js";
import type { Database } from "@/db/schemas/relations.js";
import { integrationRotations, integrations, users } from "@/db/schemas/index.js";
import type { IntegrationSummary } from "./integration.js";

export async function selectIntegrationSummaries(
  db: Database,
  where?: SQL,
): Promise<IntegrationSummary[]> {
  const lastRotations = db
    .select({
      integrationId: integrationRotations.integrationId,
      lastRotatedAt: max(integrationRotations.rotatedAt).as("last_rotated_at"),
    })
    .from(integrationRotations)
    .groupBy(integrationRotations.integrationId)
    .as("last_rotations");
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
  return rows.map(({ creatorId, creatorEmail, allowedModelIds, ...row }) => ({
    ...row,
    createdBy: creatorId && creatorEmail ? { id: creatorId, email: creatorEmail } : null,
    allowedModels: allowedModelIds.map((id) => ({ id, name: modelNames.get(id) ?? null })),
  }));
}
