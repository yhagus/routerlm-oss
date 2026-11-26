import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { apiKeys } from '@/db/schemas';

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
    throw new NotFoundException('API Key not found');
  }
  if (found.revokedAt !== null) {
    throw new ConflictException(revokedMessage);
  }
  return { encryptedKey: found.encryptedKey, integrationId: found.integrationId };
}

export function assertUserOwnsKey(found: { integrationId: string | null }): void {
  if (found.integrationId !== null) {
    throw new ConflictException(
      "An Integration's API Key is managed by its Integration; it can only be revoked here.",
    );
  }
}
