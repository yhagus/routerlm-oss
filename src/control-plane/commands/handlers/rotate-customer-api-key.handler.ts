import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth.js";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeyRotations, apiKeys } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { ControlPlaneError } from "../../models/control-plane-error.js";
import type { IssuedCustomerApiKey } from "../../models/customer-api-key.js";
import { findCustomerApiKey, findUnrevokedCustomerApiKey } from "../../models/customer-api-keys.js";
import { RotateCustomerApiKeyCommand } from "../impl/rotate-customer-api-key.command.js";

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
      // Locked and guarded again on revokedAt, as the dashboard's rotation does.
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
      // No User rotated it: the Integration did.
      await tx
        .insert(apiKeyRotations)
        .values({ apiKeyId: id, rotatedById: null, previousKeyId: current.keyId, newKeyId: keyId });
    });
    // Sign-in looks keys up by keyId in the snapshot: the old one is gone from it from now on.
    await this.snapshot.changed();
    const apiKey = await findCustomerApiKey(this.db, integrationId, id);
    return { apiKey, key };
  }
}
