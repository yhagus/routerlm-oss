import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { usageLogs } from '@/db/schemas';
import {
  integrationUsageLogOf,
  type IntegrationUsageLogPage,
  type IntegrationUsageLogRow,
} from '@/control-plane/models/integration-usage-log';
import {
  cursorOf,
  positionOf,
  type UsageLogPosition,
} from '@/control-plane/models/usage-log-cursor';
import { ListIntegrationUsageLogsQuery } from '@/control-plane/queries/impl/list-integration-usage-logs.query';

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
} satisfies Record<keyof IntegrationUsageLogRow, unknown>;

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
      usageLogs: rows.map((row) => integrationUsageLogOf(row.usageLog)),
      nextCursor: lastRow === undefined ? (page.after ?? null) : cursorOf(lastRow.position),
    };
  }
}

function writtenByFinishedTransaction(): SQL {
  return sql`${usageLogs.transactionId} < pg_snapshot_xmin(pg_current_snapshot())`;
}

function after(position: UsageLogPosition): SQL {
  return sql`(${usageLogs.transactionId}, ${usageLogs.sequence}) > (${position.transactionId}::xid8, ${position.sequence}::bigint)`;
}
