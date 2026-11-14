import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { models } from "@/db/schemas/index.js";
import type { ModelChoice } from "../../models/api-key.js";
import { ListModelChoicesQuery } from "../impl/list-model-choices.query.js";

@QueryHandler(ListModelChoicesQuery)
export class ListModelChoicesHandler implements IQueryHandler<ListModelChoicesQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<ModelChoice[]> {
    return this.db
      .select({ id: models.id, name: models.name })
      .from(models)
      .orderBy(asc(models.name));
  }
}
