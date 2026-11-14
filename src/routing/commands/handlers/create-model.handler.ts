import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "../../../db/schemas/relations.js";
import { models } from "../../../db/schemas/index.js";
import { SnapshotService } from "../../../snapshot/providers/snapshot.service.js";
import type { Model } from "../../models/model.js";
import { toModelWriteError } from "../../models/write-errors.js";
import { CreateModelCommand } from "../impl/create-model.command.js";

@CommandHandler(CreateModelCommand)
export class CreateModelHandler implements ICommandHandler<CreateModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ newModel }: CreateModelCommand): Promise<Model> {
    try {
      const [created] = await this.db.insert(models).values(newModel).returning();
      await this.snapshot.changed();
      return created;
    } catch (error) {
      throw toModelWriteError(error, newModel.name);
    }
  }
}
