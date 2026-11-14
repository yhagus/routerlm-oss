import { z } from "zod";

const MAX_NAME_LENGTH = 100;
const MAX_ALLOWED_MODELS = 500;

/** Name, optional expiry and optional allowed Models of a new API Key. */
export const newApiKeySchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  expiresAt: z.iso
    .datetime({ offset: true })
    .pipe(z.coerce.date())
    .refine((expiresAt) => expiresAt.getTime() > Date.now(), {
      error: "The expiry must be in the future",
    })
    .nullable()
    .default(null),
  // Empty means every Model.
  allowedModelIds: z
    .array(z.uuid())
    .max(MAX_ALLOWED_MODELS)
    .default([])
    .transform((ids) => [...new Set(ids)]),
});
export type NewApiKey = z.infer<typeof newApiKeySchema>;
