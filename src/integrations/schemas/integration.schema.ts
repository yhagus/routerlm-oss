import { z } from "zod";
import { hasAnyField, nothingToChange } from "@/libs/schemas/partial-update.schema.js";

const MAX_NAME_LENGTH = 100;
const MAX_ALLOWED_MODELS = 500;

// Empty means every Model.
const allowedModelIdsSchema = z
  .array(z.uuid())
  .max(MAX_ALLOWED_MODELS)
  .transform((ids) => [...new Set(ids)]);

const integrationFieldsSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  allowedModelIds: allowedModelIdsSchema,
});

/** Name and optional allowed Models of a new Integration. */
export const newIntegrationSchema = integrationFieldsSchema.extend({
  allowedModelIds: allowedModelIdsSchema.default([]),
});
export type NewIntegration = z.infer<typeof newIntegrationSchema>;

/** What an edit of an Integration changes: at least one field, each as a new Integration takes it. */
export const integrationChangesSchema = integrationFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type IntegrationChanges = z.infer<typeof integrationChangesSchema>;
