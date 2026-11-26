import { z } from 'zod';
import { hasAnyField, nothingToChange } from '@/libs/schemas/partial-update.schema';

const MAX_NAME_LENGTH = 100;
const MAX_ALLOWED_MODELS = 500;
const MAX_ALLOWED_MODEL_GROUPS = 500;

const allowedModelIdsSchema = z
  .array(z.uuid())
  .max(MAX_ALLOWED_MODELS)
  .transform((ids) => [...new Set(ids)]);

const allowedModelGroupIdsSchema = z
  .array(z.uuid())
  .max(MAX_ALLOWED_MODEL_GROUPS)
  .transform((ids) => [...new Set(ids)]);

const integrationFieldsSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  allowedModelIds: allowedModelIdsSchema,
  allowedModelGroupIds: allowedModelGroupIdsSchema,
});

export const newIntegrationSchema = integrationFieldsSchema.extend({
  allowedModelIds: allowedModelIdsSchema.default([]),
  allowedModelGroupIds: allowedModelGroupIdsSchema.default([]),
});
export type NewIntegration = z.infer<typeof newIntegrationSchema>;

export const integrationChangesSchema = integrationFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type IntegrationChanges = z.infer<typeof integrationChangesSchema>;
