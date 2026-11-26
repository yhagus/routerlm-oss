import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { apiKeys } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { ProviderKeyCipher } from '@/upstream/providers/provider-key-cipher';
import { ApiKeyAuth } from '@/api-keys/providers/api-key-auth';
import { API_KEY_CIPHER_PURPOSE, type CreatedApiKey } from '@/api-keys/models/api-key';
import { assertModelGroupsExist, assertModelsExist } from '@/libs/models/allowed-models';
import { selectApiKeySummaries } from '@/api-keys/models/api-key-summaries';
import { CreateApiKeyCommand } from '@/api-keys/commands/impl/create-api-key.command';

@CommandHandler(CreateApiKeyCommand)
export class CreateApiKeyHandler implements ICommandHandler<CreateApiKeyCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly apiKeyAuth: ApiKeyAuth,
    private readonly snapshot: SnapshotService,
    private readonly keyCipher: ProviderKeyCipher,
  ) {}

  async execute({ newKey, createdById }: CreateApiKeyCommand): Promise<CreatedApiKey> {
    await assertModelsExist(this.db, newKey.allowedModelIds);
    await assertModelGroupsExist(this.db, newKey.allowedModelGroupIds);
    const { key, id: keyId, hash } = this.apiKeyAuth.generate();
    const [created] = await this.db
      .insert(apiKeys)
      .values({
        name: newKey.name,
        keyId,
        hash,
        encryptedKey: this.keyCipher.encrypt(key, API_KEY_CIPHER_PURPOSE),
        createdById,
        expiresAt: newKey.expiresAt,
        allowedModelIds: newKey.allowedModelIds,
        allowedModelGroupIds: newKey.allowedModelGroupIds,
        spendLimit: newKey.spendLimit,
        requestRate: newKey.requestRate,
      })
      .returning({ id: apiKeys.id });
    await this.snapshot.changed();
    const [summary] = await selectApiKeySummaries(this.db, eq(apiKeys.id, created.id));
    return { ...summary, key };
  }
}
