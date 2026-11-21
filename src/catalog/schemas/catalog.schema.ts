import { z } from "zod";
import { providerUrlSchema } from "@/libs/schemas/provider-url.schema.js";
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
  PROTOCOLS_WITH_SERVICE_TIERS,
  type ProviderEndpoint,
  QUOTA_READERS,
  type ServiceTierValues,
  type TierPrices,
  UPSTREAM_PROTOCOLS,
  type UpstreamProtocol,
} from "@/db/schemas/index.js";
import {
  REASONING_EFFORTS,
  SERVICE_TIERS,
  type ServiceTier,
} from "@/inference/models/internal-format.js";

// The shape of one Catalog file: a Provider and the Upstream Models it sells.
// Field names match the `providers` and `upstream_models` columns.

/**
 * Request headers a Provider's `forwardedClientHeaders` and `fixedHeaders`
 * may not name: the credentials the gateway sets itself, and the headers
 * describing the connection or the body it writes, which would break the
 * upstream request.
 */
const UNFORWARDABLE_CLIENT_HEADERS = [
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "host",
  "content-length",
  "content-type",
  "accept-encoding",
  "connection",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/**
 * A lowercase header name a quirk may add to the request to the Provider,
 * copied from the client's request or fixed by the Catalog.
 */
const quirkHeaderNameSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, { error: "Use a lowercase header name: letters, digits and hyphens" })
  .refine((name) => !UNFORWARDABLE_CLIENT_HEADERS.includes(name), {
    error:
      "This header carries a credential or describes the connection, and only the gateway sets it",
  });

/**
 * The quirk keys the Protocol adapters, the Attempt classifier and the quota
 * readers understand (ADR 0003, ADR 0010). Unknown keys are rejected so a typo
 * in a Catalog file fails loudly instead of doing nothing.
 */
export const providerQuirksSchema = z.strictObject({
  /**
   * openai-chat only. Which assistant turns the Provider requires to carry
   * `reasoning_content` when the conversation is sent back: every assistant
   * turn, or only the ones that made tool calls.
   */
  reasoningContentInHistory: z.enum(["all-assistant-turns", "tool-call-turns"]).optional(),
  /**
   * openai-chat only. The Provider honours Anthropic-style `cache_control`
   * markers on message content parts, so the adapter keeps them.
   */
  acceptsCacheControl: z.boolean().optional(),
  /**
   * openai-chat only. The Provider takes reasoning as a `thinking` object,
   * `{type: "enabled", effort?}`, and refuses `reasoning_effort`. Thinking is
   * always enabled: these Providers' models cannot turn it off.
   */
  reasoningAsThinking: z
    .strictObject({
      /** What each reasoning effort of the internal format is called at the Provider. */
      efforts: z.record(z.enum(REASONING_EFFORTS), z.string().min(1)),
      /** The Upstream Models that accept no effort, by their id at the Provider. */
      upstreamModelsWithoutEffort: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  /**
   * openai-chat and openai-responses. A `prompt_cache_key` the client sent is
   * passed on as it is; the gateway adds none of its own (that is
   * `acceptsPromptCacheKey`).
   */
  forwardsClientPromptCacheKey: z.boolean().optional(),
  /** openai-chat and openai-responses. The Provider accepts `prompt_cache_key`, and gets the gateway's. */
  acceptsPromptCacheKey: z.boolean().optional(),
  /**
   * openai-responses only. The Provider answers only as a stream, so a
   * non-streaming client's answer is gathered from one.
   */
  alwaysStreams: z.boolean().optional(),
  /**
   * openai-responses only. Every request asks for the reasoning's encrypted
   * content, which a stateless conversation needs to send reasoning back.
   */
  includesEncryptedReasoning: z.boolean().optional(),
  /**
   * openai-responses only. The system prompt goes as a `developer` message at
   * the start of `input`, not as `instructions`.
   */
  systemAsDeveloperMessage: z.boolean().optional(),
  /** openai-responses only. Request parameters the Provider refuses, left out of every request. */
  droppedParameters: z.array(z.enum(["temperature", "top_p", "max_output_tokens"])).optional(),
  /**
   * anthropic-messages only. How many cache markers the gateway may add per
   * request, when it differs from Anthropic's four; 0 adds none. Markers the
   * client set are sent as they are.
   */
  cacheMarkerLimit: z.int().nonnegative().optional(),
  /**
   * openai-chat only. The Provider wants the output limit as
   * `max_completion_tokens` (OpenAI's reasoning models refuse `max_tokens`).
   */
  usesMaxCompletionTokens: z.boolean().optional(),
  /**
   * openai-chat only. The request headers, by lowercase name, that the gateway
   * copies from the client's request to the Provider when the client sent
   * them; a header the client left out is not sent. The Provider Account's
   * credential always overrides them.
   */
  forwardedClientHeaders: z.array(quirkHeaderNameSchema).optional(),
  /**
   * openai-chat only. Request headers, by lowercase name, sent with every
   * request to the Provider, for a Provider that needs them to answer in the
   * shape the adapter reads. They override the client's forwarded headers of
   * the same name, since the adapter depends on them; the Provider Account's
   * credential always overrides them.
   */
  fixedHeaders: z.record(quirkHeaderNameSchema, z.string().min(1)).optional(),
  /**
   * The error codes with which the Provider refuses a Provider Account whose
   * plan quota ran out, making it Exhausted instead of putting it in
   * Cooldown. A number is read from `base_resp.status_code`, `status_code`,
   * `code`, or a `(code)` at the end of `error.message`; a string from a
   * `code` or `type` anywhere in the error body's nested objects.
   */
  exhaustedErrorCodes: z.array(z.union([z.int(), z.string().min(1)])).optional(),
  /**
   * Providers whose quota reader asks another host than `baseUrl`: the base
   * URL its quota endpoint path is appended to.
   */
  quotaBaseUrl: providerUrlSchema.optional(),
});
/**
 * The quirks of a stored Provider as the inference path reads them. A
 * `quotaBaseUrl` that no longer passes the URL policy (ADR 0019) stays as
 * stored: only the quota reader uses it, and it reports the error itself, so
 * it must not fail inference.
 */
export const storedProviderQuirksSchema = providerQuirksSchema.extend({
  quotaBaseUrl: z.string().optional(),
});
export type StoredProviderQuirks = z.infer<typeof storedProviderQuirksSchema>;
export type CatalogProviderQuirks = z.infer<typeof providerQuirksSchema>;
type QuirkKey = keyof CatalogProviderQuirks;

/** The quirks every Protocol understands: the Attempt classifier and the quota readers read them. */
const QUIRKS_OF_EVERY_PROTOCOL: readonly QuirkKey[] = ["exhaustedErrorCodes", "quotaBaseUrl"];

/** The quirks only one Protocol's adapter reads, as the doc comments above say. */
const QUIRKS_OF_ONE_PROTOCOL = {
  "openai-chat": [
    "reasoningContentInHistory",
    "acceptsCacheControl",
    "reasoningAsThinking",
    "forwardsClientPromptCacheKey",
    "acceptsPromptCacheKey",
    "usesMaxCompletionTokens",
    "forwardedClientHeaders",
    "fixedHeaders",
  ],
  "anthropic-messages": ["cacheMarkerLimit"],
  "openai-responses": [
    "forwardsClientPromptCacheKey",
    "acceptsPromptCacheKey",
    "alwaysStreams",
    "includesEncryptedReasoning",
    "systemAsDeveloperMessage",
    "droppedParameters",
  ],
  "dashscope-image": [],
  "dashscope-video": [],
  "dashscope-speech": [],
  "dashscope-transcription": [],
} as const satisfies Record<UpstreamProtocol, readonly QuirkKey[]>;

/**
 * The Provider's chat endpoint: its Protocol is the one the quirks and
 * Service Tiers apply to, and its base URL the one quota readers and sign-ins
 * start from.
 */
export function chatEndpointOf(
  endpoints: readonly ProviderEndpoint[],
): ProviderEndpoint | undefined {
  return endpoints.find((endpoint) => endpoint.kind === "chat");
}

/** The Kinds of the given Upstream Models that `endpoints` has no endpoint for, each once. */
export function kindsWithoutEndpoint(
  upstreamModels: readonly { kind?: ModelKind }[],
  endpoints: readonly ProviderEndpoint[],
): ModelKind[] {
  const served = new Set(endpoints.map((endpoint) => endpoint.kind));
  return MODEL_KINDS.filter(
    (kind) => !served.has(kind) && upstreamModels.some((model) => (model.kind ?? "chat") === kind),
  );
}

/**
 * The quirk keys in `quirks` that `protocol` doesn't read, in their order;
 * without a chat Protocol, only the quirks every Protocol reads apply. A
 * Provider must have none: such a quirk would silently do nothing.
 */
export function quirksForeignToProtocol(
  protocol: UpstreamProtocol | undefined,
  quirks: Record<string, unknown>,
): string[] {
  const understood: readonly string[] = [
    ...QUIRKS_OF_EVERY_PROTOCOL,
    ...(protocol === undefined ? [] : QUIRKS_OF_ONE_PROTOCOL[protocol]),
  ];
  return Object.keys(quirks).filter((key) => !understood.includes(key));
}

/**
 * The tiers `serviceTierValues` maps on a Protocol whose adapter never sends
 * one (ADR 0014). A Provider must have none: they would silently do nothing.
 */
export function serviceTierValuesForeignToProtocol(
  protocol: UpstreamProtocol | undefined,
  serviceTierValues: ServiceTierValues,
): ServiceTier[] {
  const sendsServiceTier = PROTOCOLS_WITH_SERVICE_TIERS.some((sending) => sending === protocol);
  return sendsServiceTier
    ? []
    : SERVICE_TIERS.filter((tier) => serviceTierValues[tier] !== undefined);
}

/**
 * The tiers in `serviceTiers` that the Provider maps to no wire value (ADR
 * 0014). An Upstream Model must list none: the gateway would drop the tier on
 * every Attempt.
 */
export function serviceTiersWithoutWireValue(
  serviceTiers: readonly ServiceTier[],
  serviceTierValues: ServiceTierValues,
): ServiceTier[] {
  return serviceTiers.filter((tier) => serviceTierValues[tier] === undefined);
}

/**
 * The tiers `tierPrices` prices that `serviceTiers` doesn't list (ADR 0014).
 * An Upstream Model must have none: no Attempt could be served at that tier.
 */
export function tierPricesWithoutListedTier(
  tierPrices: Partial<Record<ServiceTier, unknown>>,
  serviceTiers: readonly ServiceTier[],
): ServiceTier[] {
  return SERVICE_TIERS.filter(
    (tier) => tierPrices[tier] !== undefined && !serviceTiers.includes(tier),
  );
}

/** A key into the logo set the dashboard owns; the gateway checks only its format. */
export const providerLogoSchema = z.string().regex(/^[a-z0-9-]+$/);

/** Kimi Code's sign-in (ADR 0012): the auth host of each region a User's account lives in. */
const kimiCodeOauthLoginSchema = z.strictObject({
  flow: z.literal("kimi-code"),
  /** The auth host of each region, without a path: a User's account lives in one of them. */
  authHosts: z.strictObject({ global: providerUrlSchema, china: providerUrlSchema }),
  clientId: z.string().min(1),
  /** The version of the Provider's own CLI the gateway presents itself as. */
  cliVersion: z.string().min(1),
}) satisfies z.ZodType<KimiCodeOauthLogin>;

/** OpenAI Codex's sign-in as the Codex CLI (ADR 0013): one issuer, no regions. */
const openAiCodexOauthLoginSchema = z.strictObject({
  flow: z.literal("openai-codex"),
  /** The auth host, without a path. */
  issuer: providerUrlSchema,
  clientId: z.string().min(1),
  /** The version of the Codex CLI the gateway presents itself as. */
  cliVersion: z.string().min(1),
}) satisfies z.ZodType<OpenAiCodexOauthLogin>;

/**
 * What signing in to the Provider needs, for a Provider that offers OAuth
 * Login, keyed by its flow. The flow itself is code.
 */
export const providerOauthLoginSchema = z.discriminatedUnion("flow", [
  kimiCodeOauthLoginSchema,
  openAiCodexOauthLoginSchema,
]);

/**
 * Where a value came from: the Provider's own pages, or models.dev when they
 * can't be read, and the day they were read.
 */
const sourceSchema = z.strictObject({
  urls: z.array(z.url()).min(1),
  retrievedOn: z.iso.date(),
});

/** USD per million tokens; null when the Provider doesn't publish it. */
const priceSchema = z.number().nonnegative().nullable();

/** USD per counted unit of a media Kind (an image, a second, a million characters); null when unpublished. */
const unitPriceSchema = z.number().nonnegative().nullable();

/** USD per unit by the tier the Provider names, such as `2K` or `720P`; null when unpublished. */
const pricesByTierSchema = z
  .record(z.string().min(1), z.number().nonnegative())
  .nullable() satisfies z.ZodType<PricesByTier | null>;

/** The sizes or resolutions a media model supports, each once; null when unknown. */
const supportedValuesSchema = z
  .array(z.string().min(1))
  .refine((values) => new Set(values).size === values.length, { error: "List each value once" })
  .nullable();

/** What the Provider calls each Service Tier on the wire (ADR 0014). */
export const serviceTierValuesSchema = z
  .strictObject({ fast: z.string().min(1), flex: z.string().min(1) })
  .partial() satisfies z.ZodType<ServiceTierValues>;

/** One Service Tier's prices; a price left out is the standard one. */
const tierPricesSchema = z
  .strictObject({
    inputPrice: z.number().nonnegative(),
    outputPrice: z.number().nonnegative(),
    cacheReadPrice: z.number().nonnegative(),
    cacheWritePrice: z.number().nonnegative(),
  })
  .partial() satisfies z.ZodType<TierPrices>;

/** The Service Tiers an Upstream Model accepts, each once. */
export const serviceTiersSchema = z
  .array(z.enum(SERVICE_TIERS))
  .refine((tiers) => new Set(tiers).size === tiers.length, {
    error: "List each Service Tier once",
  });

/** Prices per Service Tier, for the tiers that cost other than the standard prices. */
export const serviceTierPricesSchema = z
  .strictObject({ fast: tierPricesSchema, flex: tierPricesSchema })
  .partial();

const upstreamModelSchema = z.strictObject({
  upstreamModelId: z.string().min(1),
  // The name the Provider's docs give the model, such as "K2.8 Preview". Every
  // Catalog model has one, so the dashboard never falls back to the bare id.
  name: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITIES)),
  /** Null for a media Kind, which has no token context. */
  contextSize: z.int().positive().nullable(),
  maxOutputTokens: z.int().positive().nullable(),
  inputPrice: priceSchema,
  outputPrice: priceSchema,
  cacheReadPrice: priceSchema,
  cacheWritePrice: priceSchema,
  /** Chat when left out; its Provider needs an endpoint for it. */
  kind: z.enum(MODEL_KINDS).optional(),
  // The unit prices and limits of the media Kinds; none when left out.
  /** Image: per generated image, or by size tier when the price depends on the size. */
  pricePerImage: unitPriceSchema.optional(),
  pricePerImageBySize: pricesByTierSchema.optional(),
  pricePerInputImage: unitPriceSchema.optional(),
  /** Video: per output second, by resolution. */
  pricePerSecondByResolution: pricesByTierSchema.optional(),
  /** Speech: per million input characters. */
  pricePerMillionCharacters: unitPriceSchema.optional(),
  /** Transcription: per second of input audio. */
  pricePerAudioSecond: unitPriceSchema.optional(),
  maxInputImages: z.int().nonnegative().nullable().optional(),
  minDurationSeconds: z.int().positive().nullable().optional(),
  maxDurationSeconds: z.int().positive().nullable().optional(),
  /** Video resolutions, such as `720P`. */
  resolutions: supportedValuesSchema.optional(),
  /** Image sizes, such as `1024*1024`. */
  sizes: supportedValuesSchema.optional(),
  /** None when left out: the model then gets no Service Tier. */
  serviceTiers: serviceTiersSchema.optional(),
  /** Only for tiers that cost other than the standard prices. */
  tierPrices: serviceTierPricesSchema.optional(),
  releaseDate: z.iso.date(),
  source: sourceSchema,
  notes: z.string().optional(),
});
export type CatalogUpstreamModel = z.infer<typeof upstreamModelSchema>;

/** One endpoint of a Provider (ADR 0026); its Protocol must serve its Kind. */
const providerEndpointSchema = z
  .strictObject({
    kind: z.enum(MODEL_KINDS),
    protocol: z.enum(UPSTREAM_PROTOCOLS),
    /**
     * What the Protocol's path is appended to: `/chat/completions` for
     * openai-chat, `/v1/messages` for anthropic-messages, `/responses` for
     * openai-responses.
     */
    baseUrl: providerUrlSchema,
  })
  .refine(({ kind, protocol }) => PROTOCOL_KINDS[protocol] === kind, {
    error: "The Protocol doesn't serve the endpoint's Kind",
    path: ["protocol"],
  }) satisfies z.ZodType<ProviderEndpoint>;

/** A Provider's endpoints, at most one per Model Kind. */
export const providerEndpointsSchema = z
  .array(providerEndpointSchema)
  .min(1)
  .refine(
    (endpoints) => new Set(endpoints.map((endpoint) => endpoint.kind)).size === endpoints.length,
    { error: "A Provider has at most one endpoint per Kind" },
  );

export const catalogProviderSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  logo: providerLogoSchema.optional(),
  termsRisk: z.boolean().optional(),
  endpoints: providerEndpointsSchema,
  authStyle: z.enum(AUTH_STYLES),
  /** The provider's id on models.dev, used to report Catalog Gaps. */
  modelsDevProviderId: z.string().optional(),
  quirks: providerQuirksSchema,
  /** Only a Provider with Service Tiers; its Upstream Models list the tiers they accept. */
  serviceTierValues: serviceTierValuesSchema.optional(),
  /** Subscription Providers only: the code that reads its Quota Meters (ADR 0010). */
  quotaReader: z.enum(QUOTA_READERS).optional(),
  /** Only a Provider a User can sign in to; its Provider Accounts may then hold an OAuth Login. */
  oauthLogin: providerOauthLoginSchema.optional(),
  /**
   * The credentials its Provider Accounts may hold; both when left out (an
   * OAuth Login still needs `oauthLogin`).
   */
  credentialKinds: z.array(z.enum(CREDENTIAL_KINDS)).min(1).optional(),
  source: sourceSchema,
  notes: z.string().optional(),
  upstreamModels: z.array(upstreamModelSchema),
});
export type CatalogProvider = z.infer<typeof catalogProviderSchema>;
