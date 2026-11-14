import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, count, eq } from "drizzle-orm";
import { hasPostgresErrorCode, UNIQUE_VIOLATION } from "../db/postgres-errors.js";
import type { Database } from "../db/relations.js";
import { models, providerAccounts, providers, routes, upstreamModels } from "../db/schema.js";
import { RoutingChangeSignal } from "./routing-change-signal.js";
import type { ModelChanges, NewModel } from "./routing.schemas.js";

/** A Model as the dashboard API returns it. */
export type Model = typeof models.$inferSelect;

/** A Model in the dashboard's list, with how many Routes it has. */
export type ModelSummary = Pick<Model, "id" | "name" | "isEnabled" | "createdAt"> & {
  routeCount: number;
};

/** One Route as the Model page shows it: where it sends requests and whether anything can serve them. */
export type RouteSummary = Pick<
  typeof routes.$inferSelect,
  | "id"
  | "priority"
  | "isEnabled"
  | "connectTimeoutMs"
  | "firstTokenTimeoutMs"
  | "totalTimeoutMs"
  | "parameterPolicyOverride"
> & {
  provider: Pick<typeof providers.$inferSelect, "id" | "slug" | "name" | "isEnabled">;
  upstreamModel: Pick<
    typeof upstreamModels.$inferSelect,
    "id" | "upstreamModelId" | "capabilities" | "isEnabled"
  >;
  // Zero means the Route can never serve a request.
  enabledProviderAccountCount: number;
};

/** A Model with its Routes in the order the gateway tries them. */
export type ModelDetail = Model & { routes: RouteSummary[] };

@Injectable()
export class ModelsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly changeSignal: RoutingChangeSignal,
  ) {}

  listModels(): Promise<ModelSummary[]> {
    return this.db
      .select({
        id: models.id,
        name: models.name,
        isEnabled: models.isEnabled,
        createdAt: models.createdAt,
        routeCount: count(routes.id),
      })
      .from(models)
      .leftJoin(routes, eq(routes.modelId, models.id))
      .groupBy(models.id)
      .orderBy(asc(models.name));
  }

  async getModel(modelId: string): Promise<ModelDetail> {
    const [model] = await this.db.select().from(models).where(eq(models.id, modelId));
    if (!model) {
      throw new NotFoundException("Model not found");
    }
    return { ...model, routes: await this.listRoutes(modelId) };
  }

  async createModel(newModel: NewModel): Promise<Model> {
    try {
      const [created] = await this.db.insert(models).values(newModel).returning();
      await this.changeSignal.changed();
      return created;
    } catch (error) {
      throw toModelWriteError(error, newModel.name);
    }
  }

  async updateModel(modelId: string, changes: ModelChanges): Promise<Model> {
    let updated: Model | undefined;
    try {
      [updated] = await this.db
        .update(models)
        .set(changes)
        .where(eq(models.id, modelId))
        .returning();
    } catch (error) {
      throw toModelWriteError(error, changes.name);
    }
    if (!updated) {
      throw new NotFoundException("Model not found");
    }
    await this.changeSignal.changed();
    return updated;
  }

  /** Deletes the Model and its Routes. API Keys restricted to it keep its id (see `api_keys`). */
  async deleteModel(modelId: string): Promise<void> {
    const deleted = await this.db
      .delete(models)
      .where(eq(models.id, modelId))
      .returning({ id: models.id });
    if (deleted.length === 0) {
      throw new NotFoundException("Model not found");
    }
    await this.changeSignal.changed();
  }

  private listRoutes(modelId: string): Promise<RouteSummary[]> {
    return (
      this.db
        .select({
          id: routes.id,
          priority: routes.priority,
          isEnabled: routes.isEnabled,
          connectTimeoutMs: routes.connectTimeoutMs,
          firstTokenTimeoutMs: routes.firstTokenTimeoutMs,
          totalTimeoutMs: routes.totalTimeoutMs,
          parameterPolicyOverride: routes.parameterPolicyOverride,
          provider: {
            id: providers.id,
            slug: providers.slug,
            name: providers.name,
            isEnabled: providers.isEnabled,
          },
          upstreamModel: {
            id: upstreamModels.id,
            upstreamModelId: upstreamModels.upstreamModelId,
            capabilities: upstreamModels.capabilities,
            isEnabled: upstreamModels.isEnabled,
          },
          enabledProviderAccountCount: this.db.$count(
            providerAccounts,
            and(
              eq(providerAccounts.providerId, providers.id),
              eq(providerAccounts.isEnabled, true),
            ),
          ),
        })
        .from(routes)
        .innerJoin(upstreamModels, eq(routes.upstreamModelId, upstreamModels.id))
        .innerJoin(providers, eq(upstreamModels.providerId, providers.id))
        .where(eq(routes.modelId, modelId))
        // Equal priorities keep the order the Routes were added in.
        .orderBy(asc(routes.priority), asc(routes.createdAt))
    );
  }
}

function toModelWriteError(error: unknown, modelName: string | undefined): unknown {
  if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
    return new ConflictException(`A Model named "${modelName ?? ""}" already exists`);
  }
  return error;
}
