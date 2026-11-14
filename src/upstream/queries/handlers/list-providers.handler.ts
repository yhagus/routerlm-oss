import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc } from "drizzle-orm";
import type { Database } from "../../../db/relations.js";
import { providers } from "../../../db/schema.js";
import type { Provider } from "../../models/provider.js";
import { ListProvidersQuery } from "../impl/list-providers.query.js";

@QueryHandler(ListProvidersQuery)
export class ListProvidersHandler implements IQueryHandler<ListProvidersQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<Provider[]> {
    return this.db.select().from(providers).orderBy(asc(providers.name));
  }
}
