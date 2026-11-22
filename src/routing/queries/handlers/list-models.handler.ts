import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { models, routes } from "@/db/schemas/index.js";
import type { ModelSummary } from "@/routing/models/model.js";
import { ListModelsQuery } from "@/routing/queries/impl/list-models.query.js";

@QueryHandler(ListModelsQuery)
export class ListModelsHandler implements IQueryHandler<ListModelsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<ModelSummary[]> {
    return this.db
      .select({
        id: models.id,
        name: models.name,
        kind: models.kind,
        isEnabled: models.isEnabled,
        createdAt: models.createdAt,
        routeCount: count(routes.id),
      })
      .from(models)
      .leftJoin(routes, eq(routes.modelId, models.id))
      .groupBy(models.id)
      .orderBy(asc(models.name));
  }
}
