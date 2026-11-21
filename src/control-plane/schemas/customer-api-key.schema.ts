import { z } from "zod";
import {
  allowedModelIdsSchema,
  expiresAtSchema,
  MAX_CUSTOMER_ID_LENGTH,
  MAX_NAME_LENGTH,
  requestRateSchema,
  spendLimitSchema,
} from "@/api-keys/schemas/api-key.schema.js";
import { hasAnyField, nothingToChange } from "@/libs/schemas/partial-update.schema.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const customerIdSchema = z.string().trim().min(1).max(MAX_CUSTOMER_ID_LENGTH);
const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);

/** A new API Key for one of the Integration's Customers (CreateKeyRequest). */
export const newCustomerApiKeySchema = z.object({
  customerId: customerIdSchema,
  /** Defaults to the Customer id. */
  name: nameSchema.optional(),
  expiresAt: expiresAtSchema.default(null),
  allowedModelIds: allowedModelIdsSchema.default([]),
  spendLimit: spendLimitSchema.default(null),
  requestRate: requestRateSchema.default(null),
});
export type NewCustomerApiKey = z.infer<typeof newCustomerApiKeySchema>;

/**
 * What an update of a Customer's API Key changes (UpdateKeyRequest): at least
 * one field. Strict, so a Customer id sent along is refused, not ignored: it never changes.
 */
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

/** Which page of the Integration's API Keys to list (ListKeysRequest). */
export const customerApiKeyPageQuerySchema = z.object({
  customerId: customerIdSchema.optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  pageToken: z.string().min(1).optional(),
});
export type CustomerApiKeyPageQuery = z.infer<typeof customerApiKeyPageQuerySchema>;
