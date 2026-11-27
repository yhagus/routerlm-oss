import { z } from 'zod';
import { DIRECT_UPSTREAM_SLUG } from '@/libs/models/direct-upstream';
import { hasAnyField, nothingToChange } from '@/libs/schemas/partial-update.schema';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const modelGroupFieldsSchema = z.strictObject({
  name: z.string().trim().min(1),
  slug: z
    .string()
    .regex(SLUG_PATTERN, {
      error: 'A slug is lowercase letters and digits, with single hyphens between words',
    })
    .refine((slug) => slug !== DIRECT_UPSTREAM_SLUG, {
      error: `The slug "${DIRECT_UPSTREAM_SLUG}" is reserved for Direct Upstream Access`,
    }),
});

export const newModelGroupSchema = modelGroupFieldsSchema;
export type NewModelGroup = z.infer<typeof newModelGroupSchema>;

export const modelGroupChangesSchema = modelGroupFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type ModelGroupChanges = z.infer<typeof modelGroupChangesSchema>;
