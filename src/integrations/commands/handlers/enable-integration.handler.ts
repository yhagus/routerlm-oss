import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { integrations } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { integrationNotFound } from "../../models/integration-not-found.js";
import { EnableIntegrationCommand } from "../impl/enable-integration.command.js";

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
    // Its API Keys sign in from the snapshot, which must take them back.
    await this.snapshot.changed();
  }
}
