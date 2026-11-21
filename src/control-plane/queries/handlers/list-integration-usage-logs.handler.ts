import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { usageLogs } from "@/db/schemas/index.js";
import type {
  IntegrationUsageLog,
  IntegrationUsageLogPage,
} from "../../models/integration-usage-log.js";
import { cursorOf, positionOf, type UsageLogPosition } from "../../models/usage-log-cursor.js";
import { ListIntegrationUsageLogsQuery } from "../impl/list-integration-usage-logs.query.js";

const INTEGRATION_USAGE_LOG_COLUMNS = {
  id: usageLogs.id,
  createdAt: usageLogs.createdAt,
  apiKeyId: usageLogs.apiKeyId,
  apiKeyName: usageLogs.apiKeyName,
  customerId: usageLogs.customerId,
  modelName: usageLogs.modelName,
  kind: usageLogs.kind,
  clientProtocol: usageLogs.clientProtocol,
  isStreamed: usageLogs.isStreamed,
  httpStatus: usageLogs.httpStatus,
  errorCode: usageLogs.errorCode,
  errorOrigin: usageLogs.errorOrigin,
  inputTokens: usageLogs.inputTokens,
  outputTokens: usageLogs.outputTokens,
  cacheReadTokens: usageLogs.cacheReadTokens,
  cacheWriteTokens: usageLogs.cacheWriteTokens,
  reasoningTokens: usageLogs.reasoningTokens,
  imagesOut: usageLogs.imagesOut,
  imagesIn: usageLogs.imagesIn,
  outputSeconds: usageLogs.outputSeconds,
  audioSeconds: usageLogs.audioSeconds,
  characters: usageLogs.characters,
  cost: usageLogs.cost,
  timeToFirstTokenMs: usageLogs.timeToFirstTokenMs,
  durationMs: usageLogs.durationMs,
  isCancelled: usageLogs.isCancelled,
  isIncomplete: usageLogs.isIncomplete,
} satisfies Record<keyof IntegrationUsageLog, unknown>;

/**
 * Pulls in (writing transaction, sequence) order, and only rows of
 * transactions older than every one still running. A transaction still
 * running, whatever sequence it drew, commits rows that sort after every row
 * pulled so far, so the cursor never passes a row that commits late.
 */
@QueryHandler(ListIntegrationUsageLogsQuery)
export class ListIntegrationUsageLogsHandler implements IQueryHandler<ListIntegrationUsageLogsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({
    integration,
    page,
  }: ListIntegrationUsageLogsQuery): Promise<IntegrationUsageLogPage> {
    const rows = await this.db
      .select({
        usageLog: INTEGRATION_USAGE_LOG_COLUMNS,
        position: { transactionId: usageLogs.transactionId, sequence: usageLogs.sequence },
      })
      .from(usageLogs)
      .where(
        and(
          eq(usageLogs.integrationId, integration.integrationId),
          writtenByFinishedTransaction(),
          page.after === undefined ? undefined : after(positionOf(page.after)),
        ),
      )
      .orderBy(asc(usageLogs.transactionId), asc(usageLogs.sequence))
      .limit(page.pageSize);

    const lastRow = rows.at(-1);
    return {
      usageLogs: rows.map((row) => row.usageLog),
      nextCursor: lastRow === undefined ? (page.after ?? null) : cursorOf(lastRow.position),
    };
  }
}

/** Rows whose transaction is older than every transaction still running, so is over. */
function writtenByFinishedTransaction(): SQL {
  return sql`${usageLogs.transactionId} < pg_snapshot_xmin(pg_current_snapshot())`;
}

function after(position: UsageLogPosition): SQL {
  return sql`(${usageLogs.transactionId}, ${usageLogs.sequence}) > (${position.transactionId}::xid8, ${position.sequence}::bigint)`;
}
