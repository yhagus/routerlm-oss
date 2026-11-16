import { z } from "zod";
import { hasAnyField, nothingToChange } from "@/libs/schemas/partial-update.schema.js";
import {
  catalogProviderSchema,
  providerLogoSchema,
  providerOauthLoginSchema,
  providerQuirksSchema,
} from "@/catalog/schemas/catalog.schema.js";
import { QUOTA_READERS } from "@/db/schemas/index.js";

// What the dashboard sends to create or change Providers, Upstream Models and
// Provider Accounts. The fields Catalog files share with the API reuse the
// Catalog's rules, so the dashboard can't store what a Catalog file couldn't.

const providerFieldsSchema = catalogProviderSchema
  .pick({ slug: true, name: true, protocol: true, baseUrl: true, authStyle: true, quirks: true })
  .extend({
    // Null shows no logo.
    logo: providerLogoSchema.nullable(),
    // Null for a Provider that reports no quota.
    quotaReader: z.enum(QUOTA_READERS).nullable(),
    // Null for a Provider that offers no OAuth Login.
    oauthLogin: providerOauthLoginSchema.nullable(),
    credentialKinds: catalogProviderSchema.shape.credentialKinds.unwrap(),
    isEnabled: z.boolean(),
  });

export const newProviderSchema = providerFieldsSchema.extend({
  quirks: providerQuirksSchema.default({}),
  logo: providerLogoSchema.nullable().optional(),
  quotaReader: z.enum(QUOTA_READERS).nullable().optional(),
  oauthLogin: providerOauthLoginSchema.nullable().optional(),
  credentialKinds: catalogProviderSchema.shape.credentialKinds,
  isEnabled: z.boolean().optional(),
});
export type NewProvider = z.infer<typeof newProviderSchema>;

/** The slug is fixed once created: SeedCatalogCommand matches Providers by it. */
export const providerChangesSchema = providerFieldsSchema
  .omit({ slug: true })
  .partial()
  .refine(hasAnyField, nothingToChange);
export type ProviderChanges = z.infer<typeof providerChangesSchema>;

const upstreamModelFieldsSchema = catalogProviderSchema.shape.upstreamModels.element
  .omit({ source: true, notes: true })
  // Every Catalog model has a Release Date; one the operator adds may not.
  // Null clears the name, so the dashboard shows only the model id.
  .extend({
    name: z.string().min(1).nullable(),
    releaseDate: z.iso.date().nullable(),
    isEnabled: z.boolean(),
  });

export const newUpstreamModelSchema = upstreamModelFieldsSchema.extend({
  providerId: z.uuid(),
  name: z.string().min(1).nullable().optional(),
  releaseDate: z.iso.date().nullable().optional(),
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
  // Keep serving while Exhausted, when the Provider bills the excess some other way.
  continueWhenExhausted: z.boolean(),
});

/** A missing or blank `name` leaves it to CreateProviderAccountCommand to generate one. */
export const newProviderAccountSchema = providerAccountFieldsSchema.extend({
  name: z
    .string()
    .trim()
    .transform((name) => name || undefined)
    .optional(),
  providerId: z.uuid(),
  priority: z.int().nonnegative().optional(),
  isEnabled: z.boolean().optional(),
  continueWhenExhausted: z.boolean().optional(),
});
export type NewProviderAccount = z.infer<typeof newProviderAccountSchema>;

/** Sending `key` replaces the stored key; leaving it out keeps it. */
export const providerAccountChangesSchema = providerAccountFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type ProviderAccountChanges = z.infer<typeof providerAccountChangesSchema>;
