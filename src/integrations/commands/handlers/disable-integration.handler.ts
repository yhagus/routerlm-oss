import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { integrations } from "@/db/schemas";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import { integrationNotFound } from "@/integrations/models/integration-not-found";
import { DisableIntegrationCommand } from "@/integrations/commands/impl/disable-integration.command";

@CommandHandler(DisableIntegrationCommand)
export class DisableIntegrationHandler implements ICommandHandler<DisableIntegrationCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ id }: DisableIntegrationCommand): Promise<void> {
    const disabled = await this.db
      .update(integrations)
      .set({ disabledAt: sql`coalesce(${integrations.disabledAt}, now())` })
      .where(eq(integrations.id, id))
      .returning({ id: integrations.id });
    if (disabled.length === 0) {
      throw integrationNotFound();
    }
    await this.snapshot.changed();
  }
}
