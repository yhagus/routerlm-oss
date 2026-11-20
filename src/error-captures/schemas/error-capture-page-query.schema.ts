import { z } from "zod";
import { ERROR_ORIGINS, RECORDED_ATTEMPT_FAILURES } from "@/db/schemas/index.js";
import { commaSeparated, instant, searchTextSchema } from "@/usage/schemas/usage.schema.js";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/** Which hop failed: the client's request to the gateway, or an Attempt to a Provider Account. */
export const FAILED_HOPS = ["client-to-gateway", "gateway-to-provider-account"] as const;
export type FailedHopKind = (typeof FAILED_HOPS)[number];

/** How the client's request ended despite the capture: answered successfully, or not. */
export const CAPTURE_OUTCOMES = ["recovered", "failed"] as const;
export type CaptureOutcome = (typeof CAPTURE_OUTCOMES)[number];

/** Which Error Captures to list. Every filter is optional; list params match any of their picks. */
export const errorCapturePageQuerySchema = z.object({
  /** Only this request's captures: how its Usage Log links here. */
  usageLogId: z.uuid().optional(),
  /** Captured at or after. */
  from: instant.optional(),
  /** Captured before. */
  to: instant.optional(),
  /** Requests for any of these Models. */
  modelId: commaSeparated(z.uuid()).optional(),
  /** Requests with any of these API Keys; with `isPlayground: true`, these or the Playground. */
  apiKeyId: commaSeparated(z.uuid()).optional(),
  /**
   * true: only the Playground's requests; false: only client applications'.
   * Alongside `apiKeyId`, true widens the match to the Playground's requests too.
   */
  isPlayground: z.stringbool().optional(),
  /** Requests that failed with any of these Error Origins (ADR 0031). */
  errorOrigin: commaSeparated(z.enum(ERROR_ORIGINS)).optional(),
  /** Captures of any of these hops. */
  failedAt: commaSeparated(z.enum(FAILED_HOPS)).optional(),
  /** Captures of Attempts to any of these Provider Accounts. */
  providerAccountId: commaSeparated(z.uuid()).optional(),
  /** Captures of Attempts that ended with any of these failures. */
  failureReason: commaSeparated(z.enum(RECORDED_ATTEMPT_FAILURES)).optional(),
  /** Requests whose client got any of these outcomes. */
  outcome: commaSeparated(z.enum(CAPTURE_OUTCOMES)).optional(),
  /**
   * Text in the Model's name, the API Key's name, the error code, the capture's
   * User-Agent or client IP address, or the Attempt's upstream request id, ignoring case.
   */
  q: searchTextSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ErrorCapturePageQuery = z.infer<typeof errorCapturePageQuerySchema>;
