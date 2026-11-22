import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "@/db/schemas/relations.js";
import { type QuotaMeter, selectQuotaMeters } from "@/quota-meters/models/quota-meter.js";
import { ListQuotaMetersQuery } from "@/quota-meters/queries/impl/list-quota-meters.query.js";

@QueryHandler(ListQuotaMetersQuery)
export class ListQuotaMetersHandler implements IQueryHandler<ListQuotaMetersQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute({ providerAccountIds }: ListQuotaMetersQuery): Promise<Map<string, QuotaMeter[]>> {
    return selectQuotaMeters(this.db, providerAccountIds);
  }
}
