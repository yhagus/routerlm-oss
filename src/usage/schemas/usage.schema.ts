import { z } from "zod";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/** How a request ended, as the Usage page filters it. */
export const USAGE_STATUSES = ["succeeded", "failed", "cancelled"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

const instant = z.iso.datetime({ offset: true }).pipe(z.coerce.date());

/** One query param holding a comma-separated list, each element checked by `element`. */
function commaSeparated<Element extends z.ZodType<unknown, string>>(element: Element) {
  return z
    .string()
    .transform((list) => list.split(","))
    .pipe(z.array(element));
}

/** Which Usage Logs to list or total. Every filter is optional. */
export const usageFilterSchema = z.object({
  /** Received at or after. */
  from: instant.optional(),
  /** Received before. */
  to: instant.optional(),
  /** Any of these Models. */
  modelId: commaSeparated(z.uuid()).optional(),
  /** Any of these API Keys; with `isPlayground: true`, these or the Playground. */
  apiKeyId: commaSeparated(z.uuid()).optional(),
  /** Any of these statuses. */
  status: commaSeparated(z.enum(USAGE_STATUSES)).optional(),
  /**
   * true: only the Playground's requests; false: only client applications'.
   * Alongside `apiKeyId`, true widens the match to the Playground's requests too.
   */
  isPlayground: z.stringbool().optional(),
});
export type UsageFilter = z.infer<typeof usageFilterSchema>;

export const usagePageQuerySchema = usageFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type UsagePageQuery = z.infer<typeof usagePageQuerySchema>;
