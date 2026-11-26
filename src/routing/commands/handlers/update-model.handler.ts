import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { models } from "@/db/schemas";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import type { Model } from "@/routing/models/model";
import { toModelWriteError } from "@/routing/models/write-errors";
import { UpdateModelCommand } from "@/routing/commands/impl/update-model.command";

@CommandHandler(UpdateModelCommand)
export class UpdateModelHandler implements ICommandHandler<UpdateModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelId, changes }: UpdateModelCommand): Promise<Model> {
    let updated: Model | undefined;
    try {
      [updated] = await this.db
        .update(models)
        .set(changes)
        .where(eq(models.id, modelId))
        .returning();
    } catch (error) {
      throw toModelWriteError(error, changes.name);
    }
    if (!updated) {
      throw new NotFoundException("Model not found");
    }
    await this.snapshot.changed();
    return updated;
  }
}
