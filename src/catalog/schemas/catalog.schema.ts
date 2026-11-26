import { z } from 'zod';
import { providerUrlSchema } from '@/libs/schemas/provider-url.schema';
import {
  AUTH_STYLES,
  CAPABILITIES,
  CREDENTIAL_KINDS,
  type KimiCodeOauthLogin,
  MODEL_KINDS,
  type ModelKind,
  type OpenAiCodexOauthLogin,
  type PricesByTier,
  PROTOCOL_KINDS,
  type ProviderEndpoint,
  PLAN_READERS,
  QUOTA_READERS,
  type ServiceTierValues,
  type TierPrices,
  UPSTREAM_PROTOCOLS,
} from '@/db/schemas';
import {
  REASONING_EFFORTS,
  SERVICE_TIERS,
  type ServiceTier,
} from '@/inference/models/internal-format';
import {
  protocolsOf,
  quirksUnderstoodBy,
  sendsServiceTiers,
} from '@/libs/models/provider-protocols';
import { isIanaTimeZone, rangeSchema } from '@/pricing-windows/schemas/pricing-window.schema';

const UNFORWARDABLE_CLIENT_HEADERS = [
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'host',
  'content-length',
  'content-type',
  'accept-encoding',
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

const quirkHeaderNameSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, { error: 'Use a lowercase header name: letters, digits and hyphens' })
  .refine((name) => !UNFORWARDABLE_CLIENT_HEADERS.includes(name), {
    error:
      'This header carries a credential or describes the connection, and only the gateway sets it',
  });

export const providerQuirksSchema = z.strictObject({
  reasoningContentInHistory: z.enum(['all-assistant-turns', 'tool-call-turns']).optional(),
  acceptsCacheControl: z.boolean().optional(),
  reasoningAsThinking: z
    .strictObject({
      efforts: z.record(z.enum(REASONING_EFFORTS), z.string().min(1)),
      upstreamModelsWithoutEffort: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  forwardsClientPromptCacheKey: z.boolean().optional(),
  acceptsPromptCacheKey: z.boolean().optional(),
  alwaysStreams: z.boolean().optional(),
  includesEncryptedReasoning: z.boolean().optional(),
  systemAsDeveloperMessage: z.boolean().optional(),
  droppedParameters: z.array(z.enum(['temperature', 'top_p', 'max_output_tokens'])).optional(),
  cacheMarkerLimit: z.int().nonnegative().optional(),
  usesMaxCompletionTokens: z.boolean().optional(),
  forwardedClientHeaders: z.array(quirkHeaderNameSchema).optional(),
  fixedHeaders: z.record(quirkHeaderNameSchema, z.string().min(1)).optional(),
  exhaustedErrorCodes: z.array(z.union([z.int(), z.string().min(1)])).optional(),
  notInPlanErrorCodes: z.array(z.union([z.int(), z.string().min(1)])).optional(),
  quotaBaseUrl: providerUrlSchema.optional(),
});
export const storedProviderQuirksSchema = providerQuirksSchema.extend({
  quotaBaseUrl: z.string().optional(),
});
export type StoredProviderQuirks = z.infer<typeof storedProviderQuirksSchema>;
export type CatalogProviderQuirks = z.infer<typeof providerQuirksSchema>;

export function chatEndpointOf(
  endpoints: readonly ProviderEndpoint[],
): ProviderEndpoint | undefined {
  return endpoints.find((endpoint) => endpoint.kind === 'chat');
}

export function kindsWithoutEndpoint(
  upstreamModels: readonly { kind?: ModelKind }[],
  endpoints: readonly ProviderEndpoint[],
): ModelKind[] {
  const served = new Set(endpoints.map((endpoint) => endpoint.kind));
  return MODEL_KINDS.filter(
    (kind) => !served.has(kind) && upstreamModels.some((model) => (model.kind ?? 'chat') === kind),
  );
}

export function quirksForeignToEndpoints(
  endpoints: readonly ProviderEndpoint[],
  quirks: Record<string, unknown>,
): string[] {
  const understood = quirksUnderstoodBy(protocolsOf(endpoints));
  return Object.keys(quirks).filter(
    (key) => !understood.some((understoodKey) => understoodKey === key),
  );
}

export function serviceTierValuesForeignToEndpoints(
  endpoints: readonly ProviderEndpoint[],
  serviceTierValues: ServiceTierValues,
): ServiceTier[] {
  return protocolsOf(endpoints).some(sendsServiceTiers)
    ? []
    : SERVICE_TIERS.filter((tier) => serviceTierValues[tier] !== undefined);
}

export function serviceTiersWithoutWireValue(
  serviceTiers: readonly ServiceTier[],
  serviceTierValues: ServiceTierValues,
): ServiceTier[] {
  return serviceTiers.filter((tier) => serviceTierValues[tier] === undefined);
}

export function tierPricesWithoutListedTier(
  tierPrices: Partial<Record<ServiceTier, unknown>>,
  serviceTiers: readonly ServiceTier[],
): ServiceTier[] {
  return SERVICE_TIERS.filter(
    (tier) => tierPrices[tier] !== undefined && !serviceTiers.includes(tier),
  );
}

export const providerLogoSchema = z.string().regex(/^[a-z0-9-]+$/);

const kimiCodeOauthLoginSchema = z.strictObject({
  flow: z.literal('kimi-code'),
  authHosts: z.strictObject({ global: providerUrlSchema, china: providerUrlSchema }),
  clientId: z.string().min(1),
  cliVersion: z.string().min(1),
}) satisfies z.ZodType<KimiCodeOauthLogin>;

const openAiCodexOauthLoginSchema = z.strictObject({
  flow: z.literal('openai-codex'),
  issuer: providerUrlSchema,
  clientId: z.string().min(1),
  cliVersion: z.string().min(1),
}) satisfies z.ZodType<OpenAiCodexOauthLogin>;

export const providerOauthLoginSchema = z.discriminatedUnion('flow', [
  kimiCodeOauthLoginSchema,
  openAiCodexOauthLoginSchema,
]);

const sourceSchema = z.strictObject({
  urls: z.array(z.url()).min(1),
  retrievedOn: z.iso.date(),
});

const priceSchema = z.number().nonnegative().nullable();

const unitPriceSchema = z.number().nonnegative().nullable();

const pricesByTierSchema = z
  .record(z.string().min(1), z.number().nonnegative())
  .nullable() satisfies z.ZodType<PricesByTier | null>;

const supportedValuesSchema = z
  .array(z.string().min(1))
  .refine((values) => new Set(values).size === values.length, { error: 'List each value once' })
  .nullable();

export const serviceTierValuesSchema = z
  .strictObject({ fast: z.string().min(1), flex: z.string().min(1) })
  .partial() satisfies z.ZodType<ServiceTierValues>;

const tierPricesSchema = z
  .strictObject({
    inputPrice: z.number().nonnegative(),
    outputPrice: z.number().nonnegative(),
    cacheReadPrice: z.number().nonnegative(),
    cacheWritePrice: z.number().nonnegative(),
  })
  .partial() satisfies z.ZodType<TierPrices>;

export const upstreamModelProtocolsSchema = z
  .array(z.enum(UPSTREAM_PROTOCOLS))
  .refine((protocols) => new Set(protocols).size === protocols.length, {
    error: 'List each Protocol once',
  });

export const serviceTiersSchema = z
  .array(z.enum(SERVICE_TIERS))
  .refine((tiers) => new Set(tiers).size === tiers.length, {
    error: 'List each Service Tier once',
  });

export const serviceTierPricesSchema = z
  .strictObject({ fast: tierPricesSchema, flex: tierPricesSchema })
  .partial();

const windowPriceSchema = z.number().nonnegative().optional();

const catalogWindowPricesSchema = z
  .strictObject({
    pricingWindow: z.string().min(1),
    inputPrice: windowPriceSchema,
    outputPrice: windowPriceSchema,
    cacheReadPrice: windowPriceSchema,
    cacheWritePrice: windowPriceSchema,
  })
  .refine(
    (entry) =>
      [entry.inputPrice, entry.outputPrice, entry.cacheReadPrice, entry.cacheWritePrice].some(
        (price) => price !== undefined,
      ),
    { error: 'Give the Pricing Window at least one price' },
  );
export type CatalogWindowPrices = z.infer<typeof catalogWindowPricesSchema>;

const upstreamModelSchema = z.strictObject({
  upstreamModelId: z.string().min(1),
  name: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITIES)),
  contextSize: z.int().positive().nullable(),
  maxOutputTokens: z.int().positive().nullable(),
  inputPrice: priceSchema,
  outputPrice: priceSchema,
  cacheReadPrice: priceSchema,
  cacheWritePrice: priceSchema,
  kind: z.enum(MODEL_KINDS).optional(),
  protocols: upstreamModelProtocolsSchema.optional(),
  pricePerImage: unitPriceSchema.optional(),
  pricePerImageBySize: pricesByTierSchema.optional(),
  pricePerInputImage: unitPriceSchema.optional(),
  pricePerSecondByResolution: pricesByTierSchema.optional(),
  pricePerMillionCharacters: unitPriceSchema.optional(),
  pricePerAudioSecond: unitPriceSchema.optional(),
  maxInputImages: z.int().nonnegative().nullable().optional(),
  minDurationSeconds: z.int().positive().nullable().optional(),
  maxDurationSeconds: z.int().positive().nullable().optional(),
  resolutions: supportedValuesSchema.optional(),
  sizes: supportedValuesSchema.optional(),
  serviceTiers: serviceTiersSchema.optional(),
  tierPrices: serviceTierPricesSchema.optional(),
  windowPrices: z
    .array(catalogWindowPricesSchema)
    .refine(
      (entries) => new Set(entries.map((entry) => entry.pricingWindow)).size === entries.length,
      { error: 'List each Pricing Window once' },
    )
    .optional(),
  releaseDate: z.iso.date(),
  source: sourceSchema,
  notes: z.string().optional(),
});
export type CatalogUpstreamModel = z.infer<typeof upstreamModelSchema>;

const providerEndpointSchema = z
  .strictObject({
    kind: z.enum(MODEL_KINDS),
    protocol: z.enum(UPSTREAM_PROTOCOLS),
    baseUrl: providerUrlSchema,
  })
  .refine(({ kind, protocol }) => PROTOCOL_KINDS[protocol] === kind, {
    error: "The Protocol doesn't serve the endpoint's Kind",
    path: ['protocol'],
  }) satisfies z.ZodType<ProviderEndpoint>;

export const providerEndpointsSchema = z
  .array(providerEndpointSchema)
  .min(1)
  .refine(
    (endpoints) =>
      new Set(endpoints.map((endpoint) => endpoint.protocol)).size === endpoints.length,
    { error: 'A Provider has at most one endpoint per Protocol' },
  );

const catalogPricingWindowSchema = z.strictObject({
  name: z.string().trim().min(1),
  timeZone: z.string().refine(isIanaTimeZone, { error: 'Unknown time zone' }),
  ranges: z.array(rangeSchema).min(1, { error: 'A Pricing Window needs at least one range' }),
  notes: z.string().optional(),
});
export type CatalogPricingWindow = z.infer<typeof catalogPricingWindowSchema>;

export const catalogProviderSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  logo: providerLogoSchema.optional(),
  termsRisk: z.boolean().optional(),
  endpoints: providerEndpointsSchema,
  authStyle: z.enum(AUTH_STYLES),
  modelsDevProviderId: z.string().optional(),
  quirks: providerQuirksSchema,
  serviceTierValues: serviceTierValuesSchema.optional(),
  quotaReader: z.enum(QUOTA_READERS).optional(),
  planReader: z.enum(PLAN_READERS).optional(),
  oauthLogin: providerOauthLoginSchema.optional(),
  credentialKinds: z.array(z.enum(CREDENTIAL_KINDS)).min(1).optional(),
  pricingWindows: z
    .array(catalogPricingWindowSchema)
    .refine((windows) => new Set(windows.map((window) => window.name)).size === windows.length, {
      error: 'Name each Pricing Window once',
    })
    .optional(),
  source: sourceSchema,
  notes: z.string().optional(),
  upstreamModels: z.array(upstreamModelSchema),
});
export type CatalogProvider = z.infer<typeof catalogProviderSchema>;
