import { ConflictException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";

/**
 * The key's encrypted form (null when it can't be shown again), after refusing
 * a missing key with 404 and a revoked one with 409 and `revokedMessage`.
 */
export async function findUnrevokedApiKey(
  db: Database,
  id: string,
  revokedMessage: string,
): Promise<{ encryptedKey: string | null }> {
  const [found] = await db
    .select({ encryptedKey: apiKeys.encryptedKey, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .where(eq(apiKeys.id, id));
  if (!found) {
    throw new NotFoundException("API Key not found");
  }
  if (found.revokedAt !== null) {
    throw new ConflictException(revokedMessage);
  }
  return { encryptedKey: found.encryptedKey };
}
