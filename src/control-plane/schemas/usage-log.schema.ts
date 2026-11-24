import { z } from "zod";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

export const usageLogPageQuerySchema = z.object({
  after: z.string().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type UsageLogPageQuery = z.infer<typeof usageLogPageQuerySchema>;
