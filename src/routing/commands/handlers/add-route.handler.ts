import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { sql } from "drizzle-orm";
import type { Database } from "../../../db/relations.js";
import { routes } from "../../../db/schema.js";
import { SnapshotService } from "../../../snapshot/snapshot.service.js";
import type { ModelDetail } from "../../models/model.js";
import { findModelDetail } from "../../models/model-detail.js";
import { toRouteWriteError } from "../../models/write-errors.js";
import { AddRouteCommand } from "../impl/add-route.command.js";

@CommandHandler(AddRouteCommand)
export class AddRouteHandler implements ICommandHandler<AddRouteCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelId, newRoute }: AddRouteCommand): Promise<ModelDetail> {
    // Answers 404 for an unknown Model before the insert can fail on it.
    await findModelDetail(this.db, modelId);
    const lastPriorityPlusOne = sql<number>`(
      select coalesce(max(${routes.priority}) + 1, 0) from ${routes} where ${routes.modelId} = ${modelId}
    )`;
    try {
      await this.db.insert(routes).values({ ...newRoute, modelId, priority: lastPriorityPlusOne });
    } catch (error) {
      throw toRouteWriteError(error);
    }
    await this.snapshot.changed();
    return findModelDetail(this.db, modelId);
  }
}
