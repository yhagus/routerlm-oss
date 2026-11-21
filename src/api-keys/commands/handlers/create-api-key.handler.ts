import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import { ApiKeyAuth } from "../../providers/api-key-auth.js";
import { API_KEY_CIPHER_PURPOSE, type CreatedApiKey } from "../../models/api-key.js";
import { assertModelsExist } from "../../models/assert-models-exist.js";
import { selectApiKeySummaries } from "../../models/api-key-summaries.js";
import { CreateApiKeyCommand } from "../impl/create-api-key.command.js";

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
        spendLimit: newKey.spendLimit,
        requestRate: newKey.requestRate,
      })
      .returning({ id: apiKeys.id });
    await this.snapshot.changed();
    const [summary] = await selectApiKeySummaries(this.db, eq(apiKeys.id, created.id));
    return { ...summary, key };
  }
}
