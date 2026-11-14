import { BadRequestException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys, models } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { ApiKeyAuth } from "../../providers/api-key-auth.js";
import type { CreatedApiKey } from "../../models/api-key.js";
import { selectApiKeySummaries } from "../../models/api-key-summaries.js";
import { CreateApiKeyCommand } from "../impl/create-api-key.command.js";

@CommandHandler(CreateApiKeyCommand)
export class CreateApiKeyHandler implements ICommandHandler<CreateApiKeyCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly apiKeyAuth: ApiKeyAuth,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ newKey, createdById }: CreateApiKeyCommand): Promise<CreatedApiKey> {
    await this.assertModelsExist(newKey.allowedModelIds);
    const { key, id: keyId, hash } = this.apiKeyAuth.generate();
    const [created] = await this.db
      .insert(apiKeys)
      .values({
        name: newKey.name,
        keyId,
        hash,
        createdById,
        expiresAt: newKey.expiresAt,
        allowedModelIds: newKey.allowedModelIds,
      })
      .returning({ id: apiKeys.id });
    await this.snapshot.changed();
    const [summary] = await selectApiKeySummaries(this.db, eq(apiKeys.id, created.id));
    return { ...summary, key };
  }

  private async assertModelsExist(modelIds: string[]): Promise<void> {
    if (modelIds.length === 0) {
      return;
    }
    const found = await this.db
      .select({ id: models.id })
      .from(models)
      .where(inArray(models.id, modelIds));
    if (found.length !== modelIds.length) {
      throw new BadRequestException("Unknown Model in allowedModelIds");
    }
  }
}
