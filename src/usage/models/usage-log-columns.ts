import { sql } from 'drizzle-orm';
import { attempts, usageLogs, users } from '@/db/schemas';

const servedProviderName = sql<string | null>`(
  select ${attempts.providerName} from ${attempts}
  where ${attempts.usageLogId} = ${usageLogs.id} and ${usageLogs.providerAccountId} is not null
  order by ${attempts.startedAt} desc, ${attempts.id} desc
  limit 1
)`;

export const usageLogSummaryColumns = {
  id: usageLogs.id,
  createdAt: usageLogs.createdAt,
  modelId: usageLogs.modelId,
  modelName: usageLogs.modelName,
  apiKeyId: usageLogs.apiKeyId,
  apiKeyName: usageLogs.apiKeyName,
  integrationId: usageLogs.integrationId,
  integrationName: usageLogs.integrationName,
  customerId: usageLogs.customerId,
  isPlayground: usageLogs.isPlayground,
  userId: usageLogs.userId,
  userEmail: users.email,
  upstreamModelName: usageLogs.upstreamModelName,
  providerSlug: usageLogs.providerSlug,
  providerName: servedProviderName,
  providerAccountName: usageLogs.providerAccountName,
  clientProtocol: usageLogs.clientProtocol,
  upstreamProtocol: usageLogs.upstreamProtocol,
  isStreamed: usageLogs.isStreamed,
  httpStatus: usageLogs.httpStatus,
  errorCode: usageLogs.errorCode,
  errorOrigin: usageLogs.errorOrigin,
  userAgent: usageLogs.userAgent,
  clientIp: usageLogs.clientIp,
  serviceTier: usageLogs.serviceTier,
  pricingWindowName: usageLogs.pricingWindowName,
  inputTokens: usageLogs.inputTokens,
  outputTokens: usageLogs.outputTokens,
  cacheReadTokens: usageLogs.cacheReadTokens,
  cacheWriteTokens: usageLogs.cacheWriteTokens,
  reasoningTokens: usageLogs.reasoningTokens,
  requestBytes: usageLogs.requestBytes,
  responseBytes: usageLogs.responseBytes,
  cost: usageLogs.cost,
  timeToFirstTokenMs: usageLogs.timeToFirstTokenMs,
  isReasoningStreamed: usageLogs.isReasoningStreamed,
  finishReason: usageLogs.finishReason,
  maxOutputTokens: usageLogs.maxOutputTokens,
  reasoningEffort: usageLogs.reasoningEffort,
  thinkingBudgetTokens: usageLogs.thinkingBudgetTokens,
  toolCount: usageLogs.toolCount,
  toolCallCount: usageLogs.toolCallCount,
  imageCount: usageLogs.imageCount,
  durationMs: usageLogs.durationMs,
  attemptCount: usageLogs.attemptCount,
  isCancelled: usageLogs.isCancelled,
  isIncomplete: usageLogs.isIncomplete,
};
