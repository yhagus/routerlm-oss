import { z } from "zod";
import { ERROR_ORIGINS } from "@/db/schemas/index.js";
import { SERVICE_TIERS } from "@/inference/models/internal-format.js";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 200;

/** How a request ended, as the Usage page filters it. */
export const USAGE_STATUSES = ["succeeded", "failed", "cancelled"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

/** An ISO instant with its UTC offset, as a Date. */
export const instant = z.iso.datetime({ offset: true }).pipe(z.coerce.date());

/** One query param holding a comma-separated list, each element checked by `element`. */
export function commaSeparated<Element extends z.ZodType<unknown, string>>(element: Element) {
  return z
    .string()
    .transform((list) => list.split(","))
    .pipe(z.array(element));
}

/** A free-text search box: trimmed, and blank means no search. */
export const searchTextSchema = z
  .string()
  .trim()
  .max(MAX_SEARCH_LENGTH)
  .transform((text) => (text === "" ? undefined : text));

const MAX_CUSTOMER_ID_LENGTH = 200;

/** A Customer id to filter on: as an Integration gave it. */
export const customerIdFilterSchema = z.string().trim().min(1).max(MAX_CUSTOMER_ID_LENGTH);

/** Which Usage Logs to list or total. Every filter is optional. */
export const usageFilterSchema = z.object({
  /** Received at or after. */
  from: instant.optional(),
  /** Received before. */
  to: instant.optional(),
  /** Any of these Models. */
  modelId: commaSeparated(z.uuid()).optional(),
  /** Requests with the API Keys of any of these Integrations. */
  integrationId: commaSeparated(z.uuid()).optional(),
  /** Requests with the API Keys of this Customer id, exactly (it may hold commas). */
  customerId: customerIdFilterSchema.optional(),
  /** Any of these API Keys; with `isPlayground: true`, these or the Playground. */
  apiKeyId: commaSeparated(z.uuid()).optional(),
  /** Any of these statuses. */
  status: commaSeparated(z.enum(USAGE_STATUSES)).optional(),
  /** Failed with any of these Error Origins (ADR 0031). */
  errorOrigin: commaSeparated(z.enum(ERROR_ORIGINS)).optional(),
  /** Served at any of these Service Tiers. */
  serviceTier: commaSeparated(z.enum(SERVICE_TIERS)).optional(),
  /**
   * true: only the Playground's requests; false: only client applications'.
   * Alongside `apiKeyId`, true widens the match to the Playground's requests too.
   */
  isPlayground: z.stringbool().optional(),
  /**
   * Text in the Model's name, the API Key's name, the error code, the User-Agent or
   * the client IP address (ignoring case), or the Usage Log's exact id.
   */
  q: searchTextSchema.optional(),
});
export type UsageFilter = z.infer<typeof usageFilterSchema>;

export const usagePageQuerySchema = usageFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type UsagePageQuery = z.infer<typeof usagePageQuerySchema>;
