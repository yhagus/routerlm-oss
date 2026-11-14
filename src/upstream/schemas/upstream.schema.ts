import { z } from "zod";
import { catalogProviderSchema, providerQuirksSchema } from "../../catalog/catalog.schema.js";

// What the dashboard sends to create or change Providers, Upstream Models and
// Provider Accounts. The fields Catalog files share with the API reuse the
// Catalog's rules, so the dashboard can't store what a Catalog file couldn't.

const nothingToChange = { error: "Send at least one field to change" };
const hasAnyField = (changes: object): boolean => Object.keys(changes).length > 0;

const providerFieldsSchema = catalogProviderSchema
  .pick({ slug: true, name: true, protocol: true, baseUrl: true, authStyle: true, quirks: true })
  .extend({ isEnabled: z.boolean() });

export const newProviderSchema = providerFieldsSchema.extend({
  quirks: providerQuirksSchema.default({}),
  isEnabled: z.boolean().optional(),
});
export type NewProvider = z.infer<typeof newProviderSchema>;

/** The slug is fixed once created: the Catalog seeder matches Providers by it. */
export const providerChangesSchema = providerFieldsSchema
  .omit({ slug: true })
  .partial()
  .refine(hasAnyField, nothingToChange);
export type ProviderChanges = z.infer<typeof providerChangesSchema>;

const upstreamModelFieldsSchema = catalogProviderSchema.shape.upstreamModels.element
  .omit({ source: true, notes: true })
  .extend({ isEnabled: z.boolean() });

export const newUpstreamModelSchema = upstreamModelFieldsSchema.extend({
  providerId: z.uuid(),
  isEnabled: z.boolean().optional(),
});
export type NewUpstreamModel = z.infer<typeof newUpstreamModelSchema>;

/** An Upstream Model stays with the Provider it was created for. */
export const upstreamModelChangesSchema = upstreamModelFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type UpstreamModelChanges = z.infer<typeof upstreamModelChangesSchema>;

// Shorter keys would be mostly revealed by the last four characters the dashboard shows.
const MIN_PROVIDER_ACCOUNT_KEY_LENGTH = 12;

const providerAccountFieldsSchema = z.strictObject({
  name: z.string().trim().min(1),
  key: z.string().trim().min(MIN_PROVIDER_ACCOUNT_KEY_LENGTH),
  // Lower runs first.
  priority: z.int().nonnegative(),
  isEnabled: z.boolean(),
});

export const newProviderAccountSchema = providerAccountFieldsSchema.extend({
  providerId: z.uuid(),
  priority: z.int().nonnegative().optional(),
  isEnabled: z.boolean().optional(),
});
export type NewProviderAccount = z.infer<typeof newProviderAccountSchema>;

/** Sending `key` replaces the stored key; leaving it out keeps it. */
export const providerAccountChangesSchema = providerAccountFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type ProviderAccountChanges = z.infer<typeof providerAccountChangesSchema>;
