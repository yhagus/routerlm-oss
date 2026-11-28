import { and, eq, isNotNull, type SQL, sql } from 'drizzle-orm';
import { usageLogs } from '@/db/schemas';
import { statusCondition } from './usage-filters';

const MIN_MEASURED_OUTPUT_TOKENS = 32;
const MS_PER_SECOND = 1000;

const streamedOutputTokens = sql`(${usageLogs.outputTokens} - case when ${usageLogs.isReasoningStreamed} then 0 else coalesce(${usageLogs.reasoningTokens}, 0) end)`;
const msAfterFirstToken = sql`(${usageLogs.durationMs} - ${usageLogs.timeToFirstTokenMs})`;

export const outputSpeed: SQL = sql`(${streamedOutputTokens} - 1)::double precision * ${MS_PER_SECOND} / ${msAfterFirstToken}`;

export const hasOutputSpeed: SQL | undefined = and(
  eq(usageLogs.isStreamed, true),
  statusCondition('succeeded'),
  eq(usageLogs.isIncomplete, false),
  isNotNull(usageLogs.timeToFirstTokenMs),
  sql`${msAfterFirstToken} > 0`,
  sql`${streamedOutputTokens} >= ${MIN_MEASURED_OUTPUT_TOKENS}`,
);
