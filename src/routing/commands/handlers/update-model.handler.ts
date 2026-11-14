import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "../../../db/relations.js";
import { models } from "../../../db/schema.js";
import { SnapshotService } from "../../../snapshot/snapshot.service.js";
import type { Model } from "../../models/model.js";
import { toModelWriteError } from "../../models/write-errors.js";
import { UpdateModelCommand } from "../impl/update-model.command.js";

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
