import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth";
import type { Database } from "@/db/schemas/relations";
import { apiKeyRotations, apiKeys } from "@/db/schemas";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import { ControlPlaneError } from "@/control-plane/models/control-plane-error";
import type { IssuedCustomerApiKey } from "@/control-plane/models/customer-api-key";
import {
  findCustomerApiKey,
  findUnrevokedCustomerApiKey,
} from "@/control-plane/models/customer-api-keys";
import { RotateCustomerApiKeyCommand } from "@/control-plane/commands/impl/rotate-customer-api-key.command";

const REVOKED_MESSAGE = "A revoked API Key can't be rotated.";

@CommandHandler(RotateCustomerApiKeyCommand)
export class RotateCustomerApiKeyHandler implements ICommandHandler<RotateCustomerApiKeyCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly apiKeyAuth: ApiKeyAuth,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ integration, id }: RotateCustomerApiKeyCommand): Promise<IssuedCustomerApiKey> {
    const { integrationId } = integration;
    await findUnrevokedCustomerApiKey(this.db, integrationId, id, REVOKED_MESSAGE);
    const { key, id: keyId, hash } = this.apiKeyAuth.generate();
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ keyId: apiKeys.keyId })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.id, id),
            eq(apiKeys.integrationId, integrationId),
            isNull(apiKeys.revokedAt),
          ),
        )
        .for("update");
      if (!current) {
        throw new ControlPlaneError("FAILED_PRECONDITION", REVOKED_MESSAGE);
      }
      await tx.update(apiKeys).set({ keyId, hash }).where(eq(apiKeys.id, id));
      await tx
        .insert(apiKeyRotations)
        .values({ apiKeyId: id, rotatedById: null, previousKeyId: current.keyId, newKeyId: keyId });
    });
    await this.snapshot.changed();
    const apiKey = await findCustomerApiKey(this.db, integrationId, id);
    return { apiKey, key };
  }
}
