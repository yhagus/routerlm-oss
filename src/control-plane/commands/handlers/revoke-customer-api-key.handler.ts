import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { apiKeys } from "@/db/schemas";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import type { CustomerApiKey } from "@/control-plane/models/customer-api-key";
import { findCustomerApiKey } from "@/control-plane/models/customer-api-keys";
import { RevokeCustomerApiKeyCommand } from "@/control-plane/commands/impl/revoke-customer-api-key.command";

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
