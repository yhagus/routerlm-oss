import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/relations.js";
import { routes } from "../../../db/schema.js";
import { SnapshotService } from "../../../snapshot/snapshot.service.js";
import type { ModelDetail } from "../../models/model.js";
import { findModelDetail } from "../../models/model-detail.js";
import { toRouteWriteError } from "../../models/write-errors.js";
import { UpdateRouteCommand } from "../impl/update-route.command.js";

@CommandHandler(UpdateRouteCommand)
export class UpdateRouteHandler implements ICommandHandler<UpdateRouteCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelId, routeId, changes }: UpdateRouteCommand): Promise<ModelDetail> {
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
