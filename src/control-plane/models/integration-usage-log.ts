import type { usageLogs } from "@/db/schemas/index.js";

/**
 * One request made with one of the Integration's API Keys, as the control
 * plane shows it to that Integration (UsageLog in control_plane.proto): what
 * its Customer bought, never the Provider, Provider Account, Route or
 * Upstream Model that served it, nor the client's User-Agent or IP.
 */
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

/** One page of an Integration's Usage Logs, in the order they are pulled (ListUsageLogsResponse). */
export interface IntegrationUsageLogPage {
  usageLogs: IntegrationUsageLog[];
  /** Null only when the Integration has pulled nothing yet and nothing is ready. */
  nextCursor: string | null;
}
