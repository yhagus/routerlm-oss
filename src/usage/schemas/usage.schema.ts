import { z } from "zod";
import { ERROR_ORIGINS } from "@/db/schemas";
import { SERVICE_TIERS } from "@/inference/models/internal-format";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 200;

export const USAGE_STATUSES = ["succeeded", "failed", "cancelled"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

export const instant = z.iso.datetime({ offset: true }).pipe(z.coerce.date());

export function commaSeparated<Element extends z.ZodType<unknown, string>>(element: Element) {
  return z
    .string()
    .transform((list) => list.split(","))
    .pipe(z.array(element));
}

export const searchTextSchema = z
  .string()
  .trim()
  .max(MAX_SEARCH_LENGTH)
  .transform((text) => (text === "" ? undefined : text));

const MAX_CUSTOMER_ID_LENGTH = 200;

export const customerIdFilterSchema = z.string().trim().min(1).max(MAX_CUSTOMER_ID_LENGTH);

export const usageFilterSchema = z.object({
  from: instant.optional(),
  to: instant.optional(),
  modelId: commaSeparated(z.uuid()).optional(),
  integrationId: commaSeparated(z.uuid()).optional(),
  customerId: customerIdFilterSchema.optional(),
  apiKeyId: commaSeparated(z.uuid()).optional(),
  status: commaSeparated(z.enum(USAGE_STATUSES)).optional(),
  errorOrigin: commaSeparated(z.enum(ERROR_ORIGINS)).optional(),
  serviceTier: commaSeparated(z.enum(SERVICE_TIERS)).optional(),
  isPlayground: z.stringbool().optional(),
  q: searchTextSchema.optional(),
});
export type UsageFilter = z.infer<typeof usageFilterSchema>;

export const usagePageQuerySchema = usageFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type UsagePageQuery = z.infer<typeof usagePageQuerySchema>;
