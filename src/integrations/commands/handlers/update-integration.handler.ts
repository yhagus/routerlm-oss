import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import { assertModelsExist } from "@/libs/models/allowed-models.js";
import type { Database } from "@/db/schemas/relations.js";
import { integrations } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { IntegrationSummary } from "@/integrations/models/integration.js";
import { integrationNotFound } from "@/integrations/models/integration-not-found.js";
import { selectIntegrationSummaries } from "@/integrations/models/integration-summaries.js";
import { UpdateIntegrationCommand } from "@/integrations/commands/impl/update-integration.command.js";

@CommandHandler(UpdateIntegrationCommand)
export class UpdateIntegrationHandler implements ICommandHandler<UpdateIntegrationCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ id, changes }: UpdateIntegrationCommand): Promise<IntegrationSummary> {
    if (changes.allowedModelIds) {
      await assertModelsExist(this.db, changes.allowedModelIds);
    }
    const updated = await this.db
      .update(integrations)
      .set(changes)
      .where(eq(integrations.id, id))
      .returning({ id: integrations.id });
    if (updated.length === 0) {
      throw integrationNotFound();
    }
    // Requests of the Integration's API Keys record its name in their Usage Logs.
    await this.snapshot.changed();
    const [summary] = await selectIntegrationSummaries(this.db, eq(integrations.id, id));
    return summary;
  }
}
