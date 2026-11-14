import { z } from "zod";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

export const errorCapturePageQuerySchema = z.object({
  /** Only this request's captures: how its Usage Log links here. */
  usageLogId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ErrorCapturePageQuery = z.infer<typeof errorCapturePageQuerySchema>;
