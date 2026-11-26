import { BadRequestException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { routes } from "@/db/schemas";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import type { ModelDetail } from "@/routing/models/model";
import { findModelDetail } from "@/routing/models/model-detail";
import { ReorderRoutesCommand } from "@/routing/commands/impl/reorder-routes.command";

@CommandHandler(ReorderRoutesCommand)
export class ReorderRoutesHandler implements ICommandHandler<ReorderRoutesCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelId, order: { routeIds } }: ReorderRoutesCommand): Promise<ModelDetail> {
    await this.db.transaction(async (tx) => {
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
