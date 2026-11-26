import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, countDistinct, eq, isNotNull, like, max, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/db/schemas/relations";
import { apiKeys, usageLogs } from "@/db/schemas";
import { startingWith } from "@/usage/models/usage-filters";
import type { IntegrationCustomerPage } from "@/integrations/models/integration";
import { assertIntegrationExists } from "@/integrations/models/integration-exists";
import { ListIntegrationCustomersQuery } from "@/integrations/queries/impl/list-integration-customers.query";

@QueryHandler(ListIntegrationCustomersQuery)
export class ListIntegrationCustomersHandler implements IQueryHandler<ListIntegrationCustomersQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({
    integrationId,
    pageQuery: { page, pageSize, search },
  }: ListIntegrationCustomersQuery): Promise<IntegrationCustomerPage> {
    await assertIntegrationExists(this.db, integrationId);
    const keyCondition = and(
      eq(apiKeys.integrationId, integrationId),
      customerIdMatches(apiKeys.customerId, search),
    );
    const customerKeys = this.db.$with("customer_keys").as(
      this.db
        .select({
          customerId: sql<string>`${apiKeys.customerId}`.as("customer_id"),
          activeKeyCount: sql<number>`count(*) filter (where ${apiKeys.revokedAt} is null)`
            .mapWith(Number)
            .as("active_key_count"),
          revokedKeyCount: sql<number>`count(${apiKeys.revokedAt})`
            .mapWith(Number)
            .as("revoked_key_count"),
          spent: sql<number>`sum(${apiKeys.spent})`.mapWith(Number).as("spent"),
        })
        .from(apiKeys)
        .where(keyCondition)
        .groupBy(apiKeys.customerId),
    );
    const customerUsage = this.db.$with("customer_usage").as(
      this.db
        .select({
          customerId: sql<string>`${usageLogs.customerId}`.as("usage_customer_id"),
          requestCount: sql<number>`count(*)`.mapWith(Number).as("request_count"),
          cost: sql<number>`coalesce(sum(${usageLogs.cost}), 0)`.mapWith(Number).as("cost"),
          lastRequestAt: max(usageLogs.createdAt).as("last_request_at"),
        })
        .from(usageLogs)
        .where(
          and(
            eq(usageLogs.integrationId, integrationId),
            customerIdMatches(usageLogs.customerId, search),
          ),
        )
        .groupBy(usageLogs.customerId),
    );
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .with(customerKeys, customerUsage)
        .select({
          customerId: customerKeys.customerId,
          activeKeyCount: customerKeys.activeKeyCount,
          revokedKeyCount: customerKeys.revokedKeyCount,
          spent: customerKeys.spent,
          requestCount: sql<number>`coalesce(${customerUsage.requestCount}, 0)`.mapWith(Number),
          cost: sql<number>`coalesce(${customerUsage.cost}, 0)`.mapWith(Number),
          lastRequestAt: customerUsage.lastRequestAt,
        })
        .from(customerKeys)
        .leftJoin(customerUsage, eq(customerUsage.customerId, customerKeys.customerId))
        .orderBy(sql`${customerUsage.lastRequestAt} desc nulls last`, asc(customerKeys.customerId))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ total: countDistinct(apiKeys.customerId) })
        .from(apiKeys)
        .where(keyCondition),
    ]);
    return { items: rows, total, page, pageSize };
  }
}

function customerIdMatches(customerId: PgColumn, search: string | undefined): SQL | undefined {
  return search === undefined ? isNotNull(customerId) : like(customerId, startingWith(search));
}
