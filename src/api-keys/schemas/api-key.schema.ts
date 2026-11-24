import { z } from "zod";
import { hasAnyField, nothingToChange } from "@/libs/schemas/partial-update.schema.js";

export const MAX_NAME_LENGTH = 100;
export const MAX_CUSTOMER_ID_LENGTH = 200;
const MAX_ALLOWED_MODELS = 500;
export const MAX_SPEND_LIMIT_USD = 99_999_999;
const SPEND_LIMIT_DECIMALS = 10;
export const MAX_REQUEST_RATE = 2_147_483_647;

function hasAtMostSpendLimitDecimals(amount: number): boolean {
  return Number(amount.toFixed(SPEND_LIMIT_DECIMALS)) === amount;
}

export const expiresAtSchema = z.iso
  .datetime({ offset: true })
  .pipe(z.coerce.date())
  .refine((expiresAt) => expiresAt.getTime() > Date.now(), {
    error: "The expiry must be in the future",
  })
  .nullable();

export const allowedModelIdsSchema = z
  .array(z.uuid())
  .max(MAX_ALLOWED_MODELS)
  .transform((ids) => [...new Set(ids)]);

export const spendLimitSchema = z
  .number()
  .min(0)
  .max(MAX_SPEND_LIMIT_USD)
  .refine(hasAtMostSpendLimitDecimals, {
    error: `A Spend Limit has at most ${SPEND_LIMIT_DECIMALS} decimal places`,
  })
  .nullable();

export const requestRateSchema = z.number().int().min(1).max(MAX_REQUEST_RATE).nullable();

const apiKeyFieldsSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  expiresAt: expiresAtSchema,
  allowedModelIds: allowedModelIdsSchema,
  spendLimit: spendLimitSchema,
  requestRate: requestRateSchema,
});

export const newApiKeySchema = apiKeyFieldsSchema.extend({
  expiresAt: expiresAtSchema.default(null),
  allowedModelIds: allowedModelIdsSchema.default([]),
  spendLimit: spendLimitSchema.default(null),
  requestRate: requestRateSchema.default(null),
});
export type NewApiKey = z.infer<typeof newApiKeySchema>;

export const apiKeyChangesSchema = apiKeyFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type ApiKeyChanges = z.infer<typeof apiKeyChangesSchema>;

export const apiKeyListQuerySchema = z.object({
  integrationId: z.uuid().optional(),
  customerId: z.string().trim().min(1).max(MAX_CUSTOMER_ID_LENGTH).optional(),
});
export type ApiKeyListQuery = z.infer<typeof apiKeyListQuerySchema>;
