import type { usageLogs } from "@/db/schemas/index.js";

export type IntegrationUsageLog = Pick<
  typeof usageLogs.$inferSelect,
  | "id"
  | "createdAt"
  | "apiKeyId"
  | "apiKeyName"
  | "customerId"
  | "modelName"
  | "kind"
  | "clientProtocol"
  | "isStreamed"
  | "httpStatus"
  | "errorCode"
  | "errorOrigin"
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "reasoningTokens"
  | "imagesOut"
  | "imagesIn"
  | "outputSeconds"
  | "audioSeconds"
  | "characters"
  | "cost"
  | "timeToFirstTokenMs"
  | "durationMs"
  | "isCancelled"
  | "isIncomplete"
>;

export interface IntegrationUsageLogPage {
  usageLogs: IntegrationUsageLog[];
  nextCursor: string | null;
}
