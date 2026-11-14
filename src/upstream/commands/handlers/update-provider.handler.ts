import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "../../../db/relations.js";
import { providers } from "../../../db/schema.js";
import { SnapshotService } from "../../../snapshot/snapshot.service.js";
import type { Provider } from "../../models/provider.js";
import { UpdateProviderCommand } from "../impl/update-provider.command.js";

@CommandHandler(UpdateProviderCommand)
export class UpdateProviderHandler implements ICommandHandler<UpdateProviderCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ providerId, changes }: UpdateProviderCommand): Promise<Provider> {
    const [updated] = await this.db
      .update(providers)
      .set(changes)
      .where(eq(providers.id, providerId))
      .returning();
    if (!updated) {
      throw new NotFoundException("Provider not found");
    }
    await this.snapshot.changed();
    return updated;
  }
}
