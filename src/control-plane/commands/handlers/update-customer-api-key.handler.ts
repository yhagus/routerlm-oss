import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { ControlPlaneError } from "../../models/control-plane-error.js";
import type { CustomerApiKey } from "../../models/customer-api-key.js";
import {
  assertWithinCeiling,
  findCustomerApiKey,
  findUnrevokedCustomerApiKey,
} from "../../models/customer-api-keys.js";
import { UpdateCustomerApiKeyCommand } from "../impl/update-customer-api-key.command.js";

const REVOKED_MESSAGE = "A revoked API Key can't be changed.";

@CommandHandler(UpdateCustomerApiKeyCommand)
export class UpdateCustomerApiKeyHandler implements ICommandHandler<UpdateCustomerApiKeyCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({
    integration,
    id,
    changes,
  }: UpdateCustomerApiKeyCommand): Promise<CustomerApiKey> {
    const { integrationId } = integration;
    await findUnrevokedCustomerApiKey(this.db, integrationId, id, REVOKED_MESSAGE);
    if (changes.allowedModelIds) {
      await assertWithinCeiling(this.db, integration, changes.allowedModelIds);
    }
    // Guarded again on revokedAt: the key may have been revoked since the check.
    const updated = await this.db
      .update(apiKeys)
      .set(changes)
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.integrationId, integrationId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ id: apiKeys.id });
    if (updated.length === 0) {
      throw new ControlPlaneError("FAILED_PRECONDITION", REVOKED_MESSAGE);
    }
    // Everything here but the name is what inference reads from the snapshot.
    await this.snapshot.changed();
    return findCustomerApiKey(this.db, integrationId, id);
  }
}
