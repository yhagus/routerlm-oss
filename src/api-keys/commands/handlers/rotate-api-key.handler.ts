import { ConflictException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeyRotations, apiKeys } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth.js";
import { API_KEY_CIPHER_PURPOSE, type CreatedApiKey } from "@/api-keys/models/api-key.js";
import { selectApiKeySummaries } from "@/api-keys/models/api-key-summaries.js";
import {
  assertUserOwnsKey,
  findUnrevokedApiKey,
} from "@/api-keys/models/find-unrevoked-api-key.js";
import { RotateApiKeyCommand } from "@/api-keys/commands/impl/rotate-api-key.command.js";

const REVOKED_MESSAGE = "A revoked API Key can't be rotated.";

@CommandHandler(RotateApiKeyCommand)
export class RotateApiKeyHandler implements ICommandHandler<RotateApiKeyCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly apiKeyAuth: ApiKeyAuth,
    private readonly snapshot: SnapshotService,
    private readonly keyCipher: ProviderKeyCipher,
  ) {}

  async execute({ id, rotatedById }: RotateApiKeyCommand): Promise<CreatedApiKey> {
    assertUserOwnsKey(await findUnrevokedApiKey(this.db, id, REVOKED_MESSAGE));
    const { key, id: keyId, hash } = this.apiKeyAuth.generate();
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ keyId: apiKeys.keyId })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .for("update");
      if (!current) {
        throw new ConflictException(REVOKED_MESSAGE);
      }
      await tx
        .update(apiKeys)
        .set({ keyId, hash, encryptedKey: this.keyCipher.encrypt(key, API_KEY_CIPHER_PURPOSE) })
        .where(eq(apiKeys.id, id));
      await tx
        .insert(apiKeyRotations)
        .values({ apiKeyId: id, rotatedById, previousKeyId: current.keyId, newKeyId: keyId });
    });
    await this.snapshot.changed();
    const [summary] = await selectApiKeySummaries(this.db, eq(apiKeys.id, id));
    return { ...summary, key };
  }
}
