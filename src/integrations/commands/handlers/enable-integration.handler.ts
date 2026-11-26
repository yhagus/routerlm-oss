import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { integrations } from "@/db/schemas";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import { integrationNotFound } from "@/integrations/models/integration-not-found";
import { EnableIntegrationCommand } from "@/integrations/commands/impl/enable-integration.command";

@CommandHandler(EnableIntegrationCommand)
export class EnableIntegrationHandler implements ICommandHandler<EnableIntegrationCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ id }: EnableIntegrationCommand): Promise<void> {
    const enabled = await this.db
      .update(integrations)
      .set({ disabledAt: null })
      .where(eq(integrations.id, id))
      .returning({ id: integrations.id });
    if (enabled.length === 0) {
      throw integrationNotFound();
    }
    await this.snapshot.changed();
  }
}
