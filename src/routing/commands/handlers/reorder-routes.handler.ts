import { BadRequestException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "../../../db/relations.js";
import { routes } from "../../../db/schema.js";
import { SnapshotService } from "../../../snapshot/snapshot.service.js";
import type { ModelDetail } from "../../models/model.js";
import { findModelDetail } from "../../models/model-detail.js";
import { ReorderRoutesCommand } from "../impl/reorder-routes.command.js";

@CommandHandler(ReorderRoutesCommand)
export class ReorderRoutesHandler implements ICommandHandler<ReorderRoutesCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelId, order: { routeIds } }: ReorderRoutesCommand): Promise<ModelDetail> {
    await this.db.transaction(async (tx) => {
      // Locks the Routes so one added or removed meanwhile can't escape the check below.
      const current = await tx
        .select({ id: routes.id })
        .from(routes)
        .where(eq(routes.modelId, modelId))
        .for("update");
      const isEveryRouteListed =
        current.length === routeIds.length && current.every((route) => routeIds.includes(route.id));
      if (!isEveryRouteListed) {
        throw new BadRequestException("List every Route of the Model exactly once");
      }
      for (const [priority, routeId] of routeIds.entries()) {
        await tx.update(routes).set({ priority }).where(eq(routes.id, routeId));
      }
    });
    await this.snapshot.changed();
    return findModelDetail(this.db, modelId);
  }
}
