import { z } from "zod";
import {
  allowedModelIdsSchema,
  expiresAtSchema,
  MAX_CUSTOMER_ID_LENGTH,
  MAX_NAME_LENGTH,
  requestRateSchema,
  spendLimitSchema,
} from "@/api-keys/schemas/api-key.schema";
import { hasAnyField, nothingToChange } from "@/libs/schemas/partial-update.schema";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const customerIdSchema = z.string().trim().min(1).max(MAX_CUSTOMER_ID_LENGTH);
const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);

export const newCustomerApiKeySchema = z.object({
  customerId: customerIdSchema,
  name: nameSchema.optional(),
  expiresAt: expiresAtSchema.default(null),
  allowedModelIds: allowedModelIdsSchema.default([]),
  spendLimit: spendLimitSchema.default(null),
  requestRate: requestRateSchema.default(null),
});
export type NewCustomerApiKey = z.infer<typeof newCustomerApiKeySchema>;

export const customerApiKeyChangesSchema = z
  .strictObject({
    name: nameSchema,
    expiresAt: expiresAtSchema,
    allowedModelIds: allowedModelIdsSchema,
    spendLimit: spendLimitSchema,
    requestRate: requestRateSchema,
  })
  .partial()
  .refine(hasAnyField, nothingToChange);
export type CustomerApiKeyChanges = z.infer<typeof customerApiKeyChangesSchema>;

export const customerApiKeyPageQuerySchema = z.object({
  customerId: customerIdSchema.optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  pageToken: z.string().min(1).optional(),
});
export type CustomerApiKeyPageQuery = z.infer<typeof customerApiKeyPageQuerySchema>;
