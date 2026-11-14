import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, sql } from "drizzle-orm";
import { FOREIGN_KEY_VIOLATION, hasPostgresErrorCode } from "../db/postgres-errors.js";
import type { Database } from "../db/relations.js";
import { routes } from "../db/schema.js";
import { type ModelDetail, ModelsService } from "./models.service.js";
import { RoutingChangeSignal } from "./routing-change-signal.js";
import type { NewRoute, RouteChanges, RouteOrder } from "./routing.schemas.js";

/** Adds, changes, removes and reorders a Model's Routes. Each write returns the Model as it now is. */
@Injectable()
export class RoutesService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly models: ModelsService,
    private readonly changeSignal: RoutingChangeSignal,
  ) {}

  async addRoute(modelId: string, newRoute: NewRoute): Promise<ModelDetail> {
    await this.models.getModel(modelId);
    const lastPriorityPlusOne = sql<number>`(
      select coalesce(max(${routes.priority}) + 1, 0) from ${routes} where ${routes.modelId} = ${modelId}
    )`;
    try {
      await this.db.insert(routes).values({ ...newRoute, modelId, priority: lastPriorityPlusOne });
    } catch (error) {
      throw toRouteWriteError(error);
    }
    await this.changeSignal.changed();
    return this.models.getModel(modelId);
  }

  /** Enables or disables the Route, or points it at another Upstream Model. */
  async updateRoute(modelId: string, routeId: string, changes: RouteChanges): Promise<ModelDetail> {
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
    await this.changeSignal.changed();
    return this.models.getModel(modelId);
  }

  async removeRoute(modelId: string, routeId: string): Promise<void> {
    const removed = await this.db
      .delete(routes)
      .where(and(eq(routes.id, routeId), eq(routes.modelId, modelId)))
      .returning({ id: routes.id });
    if (removed.length === 0) {
      throw new NotFoundException("Route not found");
    }
    await this.changeSignal.changed();
  }

  /** Saves the new order as each Route's priority: the first listed gets 0 and is tried first. */
  async reorderRoutes(modelId: string, { routeIds }: RouteOrder): Promise<ModelDetail> {
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
    await this.changeSignal.changed();
    return this.models.getModel(modelId);
  }
}

function toRouteWriteError(error: unknown): unknown {
  // The Model was checked first, so the missing row is the Upstream Model.
  if (hasPostgresErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new NotFoundException("Upstream Model not found");
  }
  return error;
}
