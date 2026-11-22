import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "@/db/schemas/relations.js";
import type { ModelDetail } from "@/routing/models/model.js";
import { findModelDetail } from "@/routing/models/model-detail.js";
import { GetModelQuery } from "@/routing/queries/impl/get-model.query.js";

@QueryHandler(GetModelQuery)
export class GetModelHandler implements IQueryHandler<GetModelQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute({ modelId }: GetModelQuery): Promise<ModelDetail> {
    return findModelDetail(this.db, modelId);
  }
}
