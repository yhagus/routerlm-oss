import { z } from "zod";
import { hasAnyField, nothingToChange } from "@/libs/schemas/partial-update.schema.js";

export const MAX_NAME_LENGTH = 100;
export const MAX_CUSTOMER_ID_LENGTH = 200;
const MAX_ALLOWED_MODELS = 500;
// api_keys.spend_limit is numeric(18, 10): eight digits before the point.
export const MAX_SPEND_LIMIT_USD = 99_999_999;
// ...and ten after it: more would be rounded on save, so they are refused.
const SPEND_LIMIT_DECIMALS = 10;
// Requests per minute; an int32 in control_plane.proto.
export const MAX_REQUEST_RATE = 2_147_483_647;

/**
 * Whether the amount, written as briefly as JS writes it, has at most
 * SPEND_LIMIT_DECIMALS decimal places: rounding to them gives back the same number.
 */
function hasAtMostSpendLimitDecimals(amount: number): boolean {
  return Number(amount.toFixed(SPEND_LIMIT_DECIMALS)) === amount;
}

/** Null means the key never expires. */
export const expiresAtSchema = z.iso
  .datetime({ offset: true })
  .pipe(z.coerce.date())
  .refine((expiresAt) => expiresAt.getTime() > Date.now(), {
    error: "The expiry must be in the future",
  })
  .nullable();

/** Empty means every Model. */
export const allowedModelIdsSchema = z
  .array(z.uuid())
  .max(MAX_ALLOWED_MODELS)
  .transform((ids) => [...new Set(ids)]);

/** USD, to SPEND_LIMIT_DECIMALS places at most. Null means no Spend Limit. */
export const spendLimitSchema = z
  .number()
  .min(0)
  .max(MAX_SPEND_LIMIT_USD)
  .refine(hasAtMostSpendLimitDecimals, {
    error: `A Spend Limit has at most ${SPEND_LIMIT_DECIMALS} decimal places`,
  })
  .nullable();

/** Requests per minute. Null means no Request Rate. */
export const requestRateSchema = z.number().int().min(1).max(MAX_REQUEST_RATE).nullable();

const apiKeyFieldsSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  expiresAt: expiresAtSchema,
  allowedModelIds: allowedModelIdsSchema,
  spendLimit: spendLimitSchema,
  requestRate: requestRateSchema,
});

/** Name, and optional expiry, allowed Models, Spend Limit and Request Rate of a new API Key. */
export const newApiKeySchema = apiKeyFieldsSchema.extend({
  expiresAt: expiresAtSchema.default(null),
  allowedModelIds: allowedModelIdsSchema.default([]),
  spendLimit: spendLimitSchema.default(null),
  requestRate: requestRateSchema.default(null),
});
export type NewApiKey = z.infer<typeof newApiKeySchema>;

/** What an edit of an API Key changes: at least one field, each as a new key takes it. */
export const apiKeyChangesSchema = apiKeyFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type ApiKeyChanges = z.infer<typeof apiKeyChangesSchema>;

/** Which API Keys the dashboard lists. Every filter is optional. */
export const apiKeyListQuerySchema = z.object({
  /** Only the keys this Integration issued. */
  integrationId: z.uuid().optional(),
  /** Only the keys issued to this Customer id, exactly. */
  customerId: z.string().trim().min(1).max(MAX_CUSTOMER_ID_LENGTH).optional(),
});
export type ApiKeyListQuery = z.infer<typeof apiKeyListQuerySchema>;
