import type { usageLogs } from '@/db/schemas';

export type IntegrationUsageLogRow = Pick<
  typeof usageLogs.$inferSelect,
  | 'id'
  | 'createdAt'
  | 'apiKeyId'
  | 'apiKeyName'
  | 'customerId'
  | 'modelName'
  | 'kind'
  | 'clientProtocol'
  | 'isStreamed'
  | 'httpStatus'
  | 'errorCode'
  | 'errorOrigin'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'reasoningTokens'
  | 'imagesOut'
  | 'imagesIn'
  | 'outputSeconds'
  | 'audioSeconds'
  | 'characters'
  | 'cost'
  | 'timeToFirstTokenMs'
  | 'durationMs'
  | 'isCancelled'
  | 'isIncomplete'
>;

export type IntegrationUsageLog = Omit<IntegrationUsageLogRow, 'apiKeyId' | 'customerId'> & {
  apiKeyId: string;
  customerId: string;
};

export function integrationUsageLogOf(row: IntegrationUsageLogRow): IntegrationUsageLog {
  const { apiKeyId, customerId } = row;
  if (apiKeyId === null || customerId === null) {
    throw new Error(
      `Usage Log ${row.id} belongs to an Integration but names no API Key or Customer`,
    );
  }
  return { ...row, apiKeyId, customerId };
}

export interface IntegrationUsageLogPage {
  usageLogs: IntegrationUsageLog[];
  nextCursor: string | null;
}
