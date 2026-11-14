import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "../../../db/relations.js";
import { upstreamModels } from "../../../db/schema.js";
import { SnapshotService } from "../../../snapshot/snapshot.service.js";
import { deleteUnlessRouted } from "../../models/routed-models.js";
import { DeleteUpstreamModelCommand } from "../impl/delete-upstream-model.command.js";

@CommandHandler(DeleteUpstreamModelCommand)
export class DeleteUpstreamModelHandler implements ICommandHandler<DeleteUpstreamModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ upstreamModelId }: DeleteUpstreamModelCommand): Promise<void> {
    const [upstreamModel] = await this.db
      .select({ name: upstreamModels.upstreamModelId })
      .from(upstreamModels)
      .where(eq(upstreamModels.id, upstreamModelId));
    if (!upstreamModel) {
      throw new NotFoundException("Upstream Model not found");
    }
    await deleteUnlessRouted(
      this.db,
      `The Upstream Model ${upstreamModel.name}`,
      eq(upstreamModels.id, upstreamModelId),
      async () => {
        await this.db.delete(upstreamModels).where(eq(upstreamModels.id, upstreamModelId));
      },
    );
    await this.snapshot.changed();
  }
}
