import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { upstreamModels } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { toUpstreamModelWriteError, type UpstreamModel } from "../../models/upstream-model.js";
import { UpdateUpstreamModelCommand } from "../impl/update-upstream-model.command.js";

@CommandHandler(UpdateUpstreamModelCommand)
export class UpdateUpstreamModelHandler implements ICommandHandler<UpdateUpstreamModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ upstreamModelId, changes }: UpdateUpstreamModelCommand): Promise<UpstreamModel> {
    let updated: UpstreamModel | undefined;
    try {
      [updated] = await this.db
        .update(upstreamModels)
        .set(changes)
        .where(eq(upstreamModels.id, upstreamModelId))
        .returning();
    } catch (error) {
      throw toUpstreamModelWriteError(error, changes.upstreamModelId);
    }
    if (!updated) {
      throw new NotFoundException("Upstream Model not found");
    }
    await this.snapshot.changed();
    return updated;
  }
}
