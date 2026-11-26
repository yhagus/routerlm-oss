import { z } from 'zod';
import { ERROR_ORIGINS, RECORDED_ATTEMPT_FAILURES } from '@/db/schemas';
import {
  commaSeparated,
  customerIdFilterSchema,
  instant,
  searchTextSchema,
} from '@/usage/schemas/usage.schema';

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

export const FAILED_HOPS = ['client-to-gateway', 'gateway-to-provider-account'] as const;
export type FailedHopKind = (typeof FAILED_HOPS)[number];

export const CAPTURE_OUTCOMES = ['recovered', 'failed'] as const;
export type CaptureOutcome = (typeof CAPTURE_OUTCOMES)[number];

export const errorCapturePageQuerySchema = z.object({
  usageLogId: z.uuid().optional(),
  from: instant.optional(),
  to: instant.optional(),
  modelId: commaSeparated(z.uuid()).optional(),
  integrationId: commaSeparated(z.uuid()).optional(),
  customerId: customerIdFilterSchema.optional(),
  apiKeyId: commaSeparated(z.uuid()).optional(),
  isPlayground: z.stringbool().optional(),
  errorOrigin: commaSeparated(z.enum(ERROR_ORIGINS)).optional(),
  failedAt: commaSeparated(z.enum(FAILED_HOPS)).optional(),
  providerAccountId: commaSeparated(z.uuid()).optional(),
  failureReason: commaSeparated(z.enum(RECORDED_ATTEMPT_FAILURES)).optional(),
  outcome: commaSeparated(z.enum(CAPTURE_OUTCOMES)).optional(),
  q: searchTextSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ErrorCapturePageQuery = z.infer<typeof errorCapturePageQuerySchema>;
