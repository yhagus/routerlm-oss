import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/relations.js";
import { routes } from "../../../db/schema.js";
import { SnapshotService } from "../../../snapshot/snapshot.service.js";
import { RemoveRouteCommand } from "../impl/remove-route.command.js";

@CommandHandler(RemoveRouteCommand)
export class RemoveRouteHandler implements ICommandHandler<RemoveRouteCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelId, routeId }: RemoveRouteCommand): Promise<void> {
    const removed = await this.db
      .delete(routes)
      .where(and(eq(routes.id, routeId), eq(routes.modelId, modelId)))
      .returning({ id: routes.id });
    if (removed.length === 0) {
      throw new NotFoundException("Route not found");
    }
    await this.snapshot.changed();
  }
}
