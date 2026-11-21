import { ConflictException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";

/**
 * The key's encrypted form (null when it can't be shown again) and the
 * Integration that issued it (null for a User's key), after refusing a missing
 * key with 404 and a revoked one with 409 and `revokedMessage`.
 */
export async function findUnrevokedApiKey(
  db: Database,
  id: string,
  revokedMessage: string,
): Promise<{ encryptedKey: string | null; integrationId: string | null }> {
  const [found] = await db
    .select({
      encryptedKey: apiKeys.encryptedKey,
      integrationId: apiKeys.integrationId,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, id));
  if (!found) {
    throw new NotFoundException("API Key not found");
  }
  if (found.revokedAt !== null) {
    throw new ConflictException(revokedMessage);
  }
  return { encryptedKey: found.encryptedKey, integrationId: found.integrationId };
}

/**
 * Refuses, with 409, a change the dashboard would make to a key an Integration
 * issued: what the Integration sold is the Integration's to change. Revoking stays allowed.
 */
export function assertUserOwnsKey(found: { integrationId: string | null }): void {
  if (found.integrationId !== null) {
    throw new ConflictException(
      "An Integration's API Key is managed by its Integration; it can only be revoked here.",
    );
  }
}
