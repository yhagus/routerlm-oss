import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { CustomerApiKey } from "@/control-plane/models/customer-api-key.js";
import { findCustomerApiKey } from "@/control-plane/models/customer-api-keys.js";
import { RevokeCustomerApiKeyCommand } from "@/control-plane/commands/impl/revoke-customer-api-key.command.js";

@CommandHandler(RevokeCustomerApiKeyCommand)
export class RevokeCustomerApiKeyHandler implements ICommandHandler<RevokeCustomerApiKeyCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ integration, id }: RevokeCustomerApiKeyCommand): Promise<CustomerApiKey> {
    const { integrationId } = integration;
    await findCustomerApiKey(this.db, integrationId, id);
    await this.db
      .update(apiKeys)
      .set({ revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())`, encryptedKey: null })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.integrationId, integrationId)));
    await this.snapshot.changed();
    return findCustomerApiKey(this.db, integrationId, id);
  }
}
