import { z } from "zod";
import {
  allowedModelIdsSchema,
  expiresAtSchema,
  MAX_NAME_LENGTH,
} from "@/api-keys/schemas/api-key.schema.js";
import { hasAnyField, nothingToChange } from "@/libs/schemas/partial-update.schema.js";

const MAX_CUSTOMER_ID_LENGTH = 200;
// api_keys.spend_limit is numeric(18, 10): eight digits before the point.
const MAX_SPEND_LIMIT_USD = 99_999_999;
// Requests per minute; an int32 in control_plane.proto.
const MAX_REQUEST_RATE = 2_147_483_647;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const customerIdSchema = z.string().trim().min(1).max(MAX_CUSTOMER_ID_LENGTH);
const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
// Null means no Spend Limit.
const spendLimitSchema = z.number().min(0).max(MAX_SPEND_LIMIT_USD).nullable();
// Null means no limit.
const requestRateSchema = z.number().int().min(1).max(MAX_REQUEST_RATE).nullable();

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
