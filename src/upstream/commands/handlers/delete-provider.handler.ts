import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providers, upstreamModels } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { deleteUnlessRouted } from "../../models/routed-models.js";
import { DeleteProviderCommand } from "../impl/delete-provider.command.js";

@CommandHandler(DeleteProviderCommand)
export class DeleteProviderHandler implements ICommandHandler<DeleteProviderCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ providerId }: DeleteProviderCommand): Promise<void> {
    const [provider] = await this.db
      .select({ name: providers.name })
      .from(providers)
      .where(eq(providers.id, providerId));
    if (!provider) {
      throw new NotFoundException("Provider not found");
    }
    await deleteUnlessRouted(
      this.db,
      `The Provider ${provider.name}`,
      eq(upstreamModels.providerId, providerId),
      async () => {
        await this.db.delete(providers).where(eq(providers.id, providerId));
      },
    );
    await this.snapshot.changed();
  }
}
