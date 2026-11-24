import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth.js";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { IssuedCustomerApiKey } from "@/control-plane/models/customer-api-key.js";
import {
  assertWithinCeiling,
  findCustomerApiKey,
} from "@/control-plane/models/customer-api-keys.js";
import { CreateCustomerApiKeyCommand } from "@/control-plane/commands/impl/create-customer-api-key.command.js";

@CommandHandler(CreateCustomerApiKeyCommand)
export class CreateCustomerApiKeyHandler implements ICommandHandler<CreateCustomerApiKeyCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly apiKeyAuth: ApiKeyAuth,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({
    integration,
    newKey,
  }: CreateCustomerApiKeyCommand): Promise<IssuedCustomerApiKey> {
    await assertWithinCeiling(this.db, integration, newKey.allowedModelIds);
    const { key, id: keyId, hash } = this.apiKeyAuth.generate();
    const [created] = await this.db
      .insert(apiKeys)
      .values({
        name: newKey.name ?? newKey.customerId,
        keyId,
        hash,
        integrationId: integration.integrationId,
        customerId: newKey.customerId,
        expiresAt: newKey.expiresAt,
        allowedModelIds: newKey.allowedModelIds,
        spendLimit: newKey.spendLimit,
        requestRate: newKey.requestRate,
      })
      .returning({ id: apiKeys.id });
    await this.snapshot.changed();
    const apiKey = await findCustomerApiKey(this.db, integration.integrationId, created.id);
    return { apiKey, key };
  }
}
