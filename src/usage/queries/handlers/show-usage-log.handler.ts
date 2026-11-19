import { NotFoundException } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc, eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { attempts, usageLogs } from "@/db/schemas/index.js";
import type { UsageLogDetail } from "../../models/usage.js";
import { usageLogSummaryColumns } from "../../models/usage-log-columns.js";
import { ShowUsageLogQuery } from "../impl/show-usage-log.query.js";

@QueryHandler(ShowUsageLogQuery)
export class ShowUsageLogHandler implements IQueryHandler<ShowUsageLogQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ id }: ShowUsageLogQuery): Promise<UsageLogDetail> {
    const [[usageLog], usageLogAttempts] = await Promise.all([
      this.db.select(usageLogSummaryColumns).from(usageLogs).where(eq(usageLogs.id, id)),
      this.db
        .select({
          id: attempts.id,
          startedAt: attempts.startedAt,
          routeId: attempts.routeId,
          upstreamModelId: attempts.upstreamModelId,
          upstreamModelName: attempts.upstreamModelName,
          providerSlug: attempts.providerSlug,
          providerName: attempts.providerName,
          providerAccountId: attempts.providerAccountId,
          providerAccountName: attempts.providerAccountName,
          upstreamStatus: attempts.upstreamStatus,
          failureReason: attempts.failureReason,
          upstreamRequestId: attempts.upstreamRequestId,
          durationMs: attempts.durationMs,
        })
        .from(attempts)
        .where(eq(attempts.usageLogId, id))
        .orderBy(asc(attempts.startedAt), asc(attempts.id)),
    ]);
    if (!usageLog) {
      throw new NotFoundException("Usage Log not found");
    }
    return { ...usageLog, attempts: usageLogAttempts };
  }
}
