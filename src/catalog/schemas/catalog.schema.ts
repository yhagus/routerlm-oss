import { z } from "zod";
import {
  AUTH_STYLES,
  CAPABILITIES,
  QUOTA_READERS,
  UPSTREAM_PROTOCOLS,
  type UpstreamProtocol,
} from "@/db/schemas/index.js";
import { REASONING_EFFORTS } from "@/inference/models/internal-format.js";

// The shape of one Catalog file: a Provider and the Upstream Models it sells.
// Field names match the `providers` and `upstream_models` columns.

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
   * openai-chat only. A `prompt_cache_key` the client sent is passed on as
   * it is; the gateway adds none of its own (that is `acceptsPromptCacheKey`).
   */
  forwardsClientPromptCacheKey: z.boolean().optional(),
  /** openai-chat only. The Provider accepts `prompt_cache_key`, and gets the gateway's. */
  acceptsPromptCacheKey: z.boolean().optional(),
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
  quotaBaseUrl: z.url().optional(),
});
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
  ],
  "anthropic-messages": ["cacheMarkerLimit"],
} as const satisfies Record<UpstreamProtocol, readonly QuirkKey[]>;

/**
 * The quirk keys in `quirks` that `protocol` doesn't read, in their order.
 * A Provider must have none: such a quirk would silently do nothing.
 */
export function quirksForeignToProtocol(
  protocol: UpstreamProtocol,
  quirks: Record<string, unknown>,
): string[] {
  const understood: readonly string[] = [
    ...QUIRKS_OF_EVERY_PROTOCOL,
    ...QUIRKS_OF_ONE_PROTOCOL[protocol],
  ];
  return Object.keys(quirks).filter((key) => !understood.includes(key));
}

/** A key into the logo set the dashboard owns; the gateway checks only its format. */
export const providerLogoSchema = z.string().regex(/^[a-z0-9-]+$/);

/**
 * What signing in to the Provider needs, for a Provider that offers OAuth
 * Login (ADR 0012). The device-code flow itself is code.
 */
export const providerOauthLoginSchema = z.strictObject({
  /** The auth host of each region, without a path: a User's account lives in one of them. */
  authHosts: z.strictObject({ global: z.url(), china: z.url() }),
  clientId: z.string().min(1),
  /** The version of the Provider's own CLI the gateway presents itself as. */
  cliVersion: z.string().min(1),
});

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

const upstreamModelSchema = z.strictObject({
  upstreamModelId: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITIES)),
  contextSize: z.int().positive(),
  maxOutputTokens: z.int().positive().nullable(),
  inputPrice: priceSchema,
  outputPrice: priceSchema,
  cacheReadPrice: priceSchema,
  cacheWritePrice: priceSchema,
  releaseDate: z.iso.date(),
  source: sourceSchema,
  notes: z.string().optional(),
});
export type CatalogUpstreamModel = z.infer<typeof upstreamModelSchema>;

export const catalogProviderSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  logo: providerLogoSchema.optional(),
  protocol: z.enum(UPSTREAM_PROTOCOLS),
  /**
   * What the Protocol's path is appended to: `/chat/completions` for
   * openai-chat, `/v1/messages` for anthropic-messages.
   */
  baseUrl: z.url(),
  authStyle: z.enum(AUTH_STYLES),
  quirks: providerQuirksSchema,
  /** Subscription Providers only: the code that reads its Quota Meters (ADR 0010). */
  quotaReader: z.enum(QUOTA_READERS).optional(),
  /** Only a Provider a User can sign in to; its Provider Accounts may then hold an OAuth Login. */
  oauthLogin: providerOauthLoginSchema.optional(),
  source: sourceSchema,
  notes: z.string().optional(),
  upstreamModels: z.array(upstreamModelSchema),
});
export type CatalogProvider = z.infer<typeof catalogProviderSchema>;
