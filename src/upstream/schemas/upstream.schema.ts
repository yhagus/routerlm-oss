import { z } from "zod";
import { hasAnyField, nothingToChange } from "@/libs/schemas/partial-update.schema.js";
import {
  catalogProviderSchema,
  providerLogoSchema,
  providerOauthLoginSchema,
  providerQuirksSchema,
  serviceTierPricesSchema,
  serviceTiersSchema,
  serviceTierValuesSchema,
  upstreamModelProtocolsSchema,
} from "@/catalog/schemas/catalog.schema.js";
import { QUOTA_READERS } from "@/db/schemas/index.js";

const providerFieldsSchema = catalogProviderSchema
  .pick({ slug: true, name: true, endpoints: true, authStyle: true, quirks: true })
  .extend({
    serviceTierValues: serviceTierValuesSchema,
    logo: providerLogoSchema.nullable(),
    termsRisk: z.boolean(),
    quotaReader: z.enum(QUOTA_READERS).nullable(),
    oauthLogin: providerOauthLoginSchema.nullable(),
    credentialKinds: catalogProviderSchema.shape.credentialKinds.unwrap(),
    isEnabled: z.boolean(),
  });

export const newProviderSchema = providerFieldsSchema.extend({
  quirks: providerQuirksSchema.default({}),
  serviceTierValues: serviceTierValuesSchema.default({}),
  logo: providerLogoSchema.nullable().optional(),
  termsRisk: z.boolean().optional(),
  quotaReader: z.enum(QUOTA_READERS).nullable().optional(),
  oauthLogin: providerOauthLoginSchema.nullable().optional(),
  credentialKinds: catalogProviderSchema.shape.credentialKinds,
  isEnabled: z.boolean().optional(),
});
export type NewProvider = z.infer<typeof newProviderSchema>;

export const providerChangesSchema = providerFieldsSchema
  .omit({ slug: true })
  .partial()
  .refine(hasAnyField, nothingToChange);
export type ProviderChanges = z.infer<typeof providerChangesSchema>;

const upstreamModelFieldsSchema = catalogProviderSchema.shape.upstreamModels.element
  .omit({ source: true, notes: true })
  .extend({
    name: z.string().min(1).nullable(),
    releaseDate: z.iso.date().nullable(),
    protocols: upstreamModelProtocolsSchema,
    serviceTiers: serviceTiersSchema,
    tierPrices: serviceTierPricesSchema,
    isEnabled: z.boolean(),
  });

export const newUpstreamModelSchema = upstreamModelFieldsSchema.extend({
  providerId: z.uuid(),
  name: z.string().min(1).nullable().optional(),
  releaseDate: z.iso.date().nullable().optional(),
  protocols: upstreamModelProtocolsSchema.optional(),
  serviceTiers: serviceTiersSchema.optional(),
  tierPrices: serviceTierPricesSchema.optional(),
  isEnabled: z.boolean().optional(),
});
export type NewUpstreamModel = z.infer<typeof newUpstreamModelSchema>;

export const upstreamModelChangesSchema = upstreamModelFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type UpstreamModelChanges = z.infer<typeof upstreamModelChangesSchema>;

const MIN_PROVIDER_ACCOUNT_KEY_LENGTH = 12;

const providerAccountFieldsSchema = z.strictObject({
  name: z.string().trim().min(1),
  key: z.string().trim().min(MIN_PROVIDER_ACCOUNT_KEY_LENGTH),
  priority: z.int().nonnegative(),
  isEnabled: z.boolean(),
  continueWhenExhausted: z.boolean(),
});

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

export const providerAccountChangesSchema = providerAccountFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type ProviderAccountChanges = z.infer<typeof providerAccountChangesSchema>;
