import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providers } from "@/db/schemas/index.js";
import type { Provider } from "@/upstream/models/provider.js";
import { ListProvidersQuery } from "@/upstream/queries/impl/list-providers.query.js";

@QueryHandler(ListProvidersQuery)
export class ListProvidersHandler implements IQueryHandler<ListProvidersQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<Provider[]> {
    return this.db.select().from(providers).orderBy(asc(providers.name));
  }
}
