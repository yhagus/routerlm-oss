import { z } from "zod";
import { AUTH_STYLES, CAPABILITIES, UPSTREAM_PROTOCOLS } from "../db/schema.js";

// The shape of one Catalog file: a Provider and the Upstream Models it sells.
// Field names match the `providers` and `upstream_models` columns.

/**
 * The quirk keys the Protocol adapters understand (ADR 0003). Unknown keys are
 * rejected so a typo in a Catalog file fails loudly instead of doing nothing.
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
  /** openai-chat only. The Provider accepts `prompt_cache_key`. */
  acceptsPromptCacheKey: z.boolean().optional(),
});
export type CatalogProviderQuirks = z.infer<typeof providerQuirksSchema>;

/** Where a value came from: the Provider's own pages, and the day they were read. */
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
  source: sourceSchema,
  notes: z.string().optional(),
});
export type CatalogUpstreamModel = z.infer<typeof upstreamModelSchema>;

export const catalogProviderSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  protocol: z.enum(UPSTREAM_PROTOCOLS),
  /**
   * What the Protocol's path is appended to: `/chat/completions` for
   * openai-chat, `/v1/messages` for anthropic-messages.
   */
  baseUrl: z.url(),
  authStyle: z.enum(AUTH_STYLES),
  quirks: providerQuirksSchema,
  source: sourceSchema,
  notes: z.string().optional(),
  upstreamModels: z.array(upstreamModelSchema),
});
export type CatalogProvider = z.infer<typeof catalogProviderSchema>;
