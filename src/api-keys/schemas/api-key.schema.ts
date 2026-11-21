import { z } from "zod";
import { hasAnyField, nothingToChange } from "@/libs/schemas/partial-update.schema.js";

export const MAX_NAME_LENGTH = 100;
const MAX_ALLOWED_MODELS = 500;

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

const apiKeyFieldsSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  expiresAt: expiresAtSchema,
  allowedModelIds: allowedModelIdsSchema,
});

/** Name, optional expiry and optional allowed Models of a new API Key. */
export const newApiKeySchema = apiKeyFieldsSchema.extend({
  expiresAt: expiresAtSchema.default(null),
  allowedModelIds: allowedModelIdsSchema.default([]),
});
export type NewApiKey = z.infer<typeof newApiKeySchema>;

/** What an edit of an API Key changes: at least one field, each as a new key takes it. */
export const apiKeyChangesSchema = apiKeyFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type ApiKeyChanges = z.infer<typeof apiKeyChangesSchema>;
