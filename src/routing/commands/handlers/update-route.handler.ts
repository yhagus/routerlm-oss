import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { routes } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { ModelDetail } from "@/routing/models/model.js";
import { findModelDetail } from "@/routing/models/model-detail.js";
import { assertRouteKindFits } from "@/routing/models/route-kind.js";
import { toRouteWriteError } from "@/routing/models/write-errors.js";
import { UpdateRouteCommand } from "@/routing/commands/impl/update-route.command.js";

@CommandHandler(UpdateRouteCommand)
export class UpdateRouteHandler implements ICommandHandler<UpdateRouteCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelId, routeId, changes }: UpdateRouteCommand): Promise<ModelDetail> {
    if (changes.upstreamModelId !== undefined) {
      const model = await findModelDetail(this.db, modelId);
      await assertRouteKindFits(this.db, model, changes.upstreamModelId);
    }
    let updated: { id: string } | undefined;
    try {
      [updated] = await this.db
        .update(routes)
        .set(changes)
        .where(and(eq(routes.id, routeId), eq(routes.modelId, modelId)))
        .returning({ id: routes.id });
    } catch (error) {
      throw toRouteWriteError(error);
    }
    if (!updated) {
      throw new NotFoundException("Route not found");
    }
    await this.snapshot.changed();
    return findModelDetail(this.db, modelId);
  }
}
