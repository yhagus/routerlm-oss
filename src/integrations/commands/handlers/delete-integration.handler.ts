import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys, integrations } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { integrationNotFound } from "@/integrations/models/integration-not-found.js";
import { DeleteIntegrationCommand } from "@/integrations/commands/impl/delete-integration.command.js";

@CommandHandler(DeleteIntegrationCommand)
export class DeleteIntegrationHandler implements ICommandHandler<DeleteIntegrationCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ id }: DeleteIntegrationCommand): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(apiKeys)
        .set({ revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())`, encryptedKey: null })
        .where(eq(apiKeys.integrationId, id));
      const deleted = await tx
        .delete(integrations)
        .where(eq(integrations.id, id))
        .returning({ id: integrations.id });
      if (deleted.length === 0) {
        throw integrationNotFound();
      }
    });
    await this.snapshot.changed();
  }
}
