import { z } from "zod";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/** How a request ended, as the Usage page filters it. */
export const USAGE_STATUSES = ["succeeded", "failed", "cancelled"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

const instant = z.iso.datetime({ offset: true }).pipe(z.coerce.date());

/** Which Usage Logs to list or total. Every filter is optional. */
export const usageFilterSchema = z.object({
  /** Received at or after. */
  from: instant.optional(),
  /** Received before. */
  to: instant.optional(),
  modelId: z.uuid().optional(),
  apiKeyId: z.uuid().optional(),
  status: z.enum(USAGE_STATUSES).optional(),
  /** true: only the Playground's requests; false: only client applications'. */
  isPlayground: z.stringbool().optional(),
});
export type UsageFilter = z.infer<typeof usageFilterSchema>;

export const usagePageQuerySchema = usageFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type UsagePageQuery = z.infer<typeof usagePageQuerySchema>;
