import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { count, desc } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { usageLogs } from "@/db/schemas/index.js";
import type { UsageLogPage } from "../../models/usage.js";
import { whereFilter } from "../../models/usage-filters.js";
import { usageLogSummaryColumns } from "../../models/usage-log-columns.js";
import { ListUsageLogsQuery } from "../impl/list-usage-logs.query.js";

/**
 * Filtering and paging run in SQL, so a large table is never loaded whole.
 * Reads only usage_logs: its names are copied at request time (ADR 0024).
 */
@QueryHandler(ListUsageLogsQuery)
export class ListUsageLogsHandler implements IQueryHandler<ListUsageLogsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ pageQuery }: ListUsageLogsQuery): Promise<UsageLogPage> {
    const where = whereFilter(pageQuery);
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select(usageLogSummaryColumns)
        .from(usageLogs)
        .where(where)
        .orderBy(desc(usageLogs.createdAt), desc(usageLogs.id))
        .limit(pageQuery.pageSize)
        .offset((pageQuery.page - 1) * pageQuery.pageSize),
      this.db.select({ total: count() }).from(usageLogs).where(where),
    ]);
    return { items, total, page: pageQuery.page, pageSize: pageQuery.pageSize };
  }
}
