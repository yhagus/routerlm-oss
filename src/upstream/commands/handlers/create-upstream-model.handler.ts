import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "../../../db/relations.js";
import { upstreamModels } from "../../../db/schema.js";
import { SnapshotService } from "../../../snapshot/snapshot.service.js";
import { toUpstreamModelWriteError, type UpstreamModel } from "../../models/upstream-model.js";
import { CreateUpstreamModelCommand } from "../impl/create-upstream-model.command.js";

@CommandHandler(CreateUpstreamModelCommand)
export class CreateUpstreamModelHandler implements ICommandHandler<CreateUpstreamModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ newUpstreamModel }: CreateUpstreamModelCommand): Promise<UpstreamModel> {
    try {
      const [created] = await this.db.insert(upstreamModels).values(newUpstreamModel).returning();
      await this.snapshot.changed();
      return created;
    } catch (error) {
      throw toUpstreamModelWriteError(error, newUpstreamModel.upstreamModelId);
    }
  }
}
