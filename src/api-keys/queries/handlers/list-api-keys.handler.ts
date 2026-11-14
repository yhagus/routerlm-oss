import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "../../../db/schemas/relations.js";
import type { ApiKeySummary } from "../../models/api-key.js";
import { selectApiKeySummaries } from "../../models/api-key-summaries.js";
import { ListApiKeysQuery } from "../impl/list-api-keys.query.js";

@QueryHandler(ListApiKeysQuery)
export class ListApiKeysHandler implements IQueryHandler<ListApiKeysQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<ApiKeySummary[]> {
    return selectApiKeySummaries(this.db);
  }
}
