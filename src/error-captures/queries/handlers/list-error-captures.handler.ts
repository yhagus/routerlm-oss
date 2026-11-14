import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { count, desc, eq } from "drizzle-orm";
import type { Database } from "../../../db/relations.js";
import { errorCaptures } from "../../../db/schema.js";
import type { ErrorCapturePage } from "../../models/error-capture.js";
import { selectSummaryRows, summaryOf } from "../../models/error-capture-summaries.js";
import { ListErrorCapturesQuery } from "../impl/list-error-captures.query.js";

@QueryHandler(ListErrorCapturesQuery)
export class ListErrorCapturesHandler implements IQueryHandler<ListErrorCapturesQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ pageQuery }: ListErrorCapturesQuery): Promise<ErrorCapturePage> {
    const where = pageQuery.usageLogId
      ? eq(errorCaptures.usageLogId, pageQuery.usageLogId)
      : undefined;
    const [rows, [{ total }]] = await Promise.all([
      selectSummaryRows(this.db)
        .where(where)
        .orderBy(desc(errorCaptures.createdAt), desc(errorCaptures.id))
        .limit(pageQuery.pageSize)
        .offset((pageQuery.page - 1) * pageQuery.pageSize),
      this.db.select({ total: count() }).from(errorCaptures).where(where),
    ]);
    return {
      items: rows.map(summaryOf),
      total,
      page: pageQuery.page,
      pageSize: pageQuery.pageSize,
    };
  }
}
