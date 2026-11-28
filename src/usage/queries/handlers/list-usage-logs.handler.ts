import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { count, desc, eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { usageLogs, users } from '@/db/schemas';
import type { UsageLogPage } from '@/usage/models/usage';
import { whereFilter } from '@/usage/models/usage-filters';
import { usageLogSummaryColumns } from '@/usage/models/usage-log-columns';
import { ListUsageLogsQuery } from '@/usage/queries/impl/list-usage-logs.query';

@QueryHandler(ListUsageLogsQuery)
export class ListUsageLogsHandler implements IQueryHandler<ListUsageLogsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ pageQuery }: ListUsageLogsQuery): Promise<UsageLogPage> {
    const where = whereFilter(pageQuery);
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select(usageLogSummaryColumns)
        .from(usageLogs)
        .leftJoin(users, eq(users.id, usageLogs.userId))
        .where(where)
        .orderBy(desc(usageLogs.createdAt), desc(usageLogs.id))
        .limit(pageQuery.pageSize)
        .offset((pageQuery.page - 1) * pageQuery.pageSize),
      this.db.select({ total: count() }).from(usageLogs).where(where),
    ]);
    return { items, total, page: pageQuery.page, pageSize: pageQuery.pageSize };
  }
}
