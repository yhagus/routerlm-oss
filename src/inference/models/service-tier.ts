import type { ServiceTierValues } from "@/db/schemas/index.js";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import type { UpstreamModelPrices } from "@/usage/models/usage-job.js";
import type { ServiceTier } from "./internal-format.js";

/**
 * What an OpenAI client's `service_tier` asks for (ADR 0014): OpenAI's
 * `priority` and Codex's legacy `fast` are fast, `flex` is flex. `default`,
 * `auto` and anything else ask for no tier.
 */
const OPENAI_CLIENT_TIERS: ReadonlyMap<string, ServiceTier> = new Map([
  ["priority", "fast"],
  ["fast", "fast"],
  ["flex", "flex"],
]);

export function serviceTierOfOpenAiClient(
  clientValue: string | null | undefined,
): ServiceTier | undefined {
  return clientValue == null ? undefined : OPENAI_CLIENT_TIERS.get(clientValue);
}

/** The Service Tier an Attempt asks for, and what its Provider calls it on the wire. */
export interface SentServiceTier {
  tier: ServiceTier;
  wireValue: string;
}

/**
 * The tier an Attempt on `upstreamModel` sends, or null when the request asks
 * for none or the Upstream Model doesn't accept it: the tier is then dropped
 * for this Attempt, with no error (ADR 0014).
 */
export function serviceTierSentTo(
  tier: ServiceTier | undefined,
  upstreamModel: SnapshotUpstreamModel,
): SentServiceTier | null {
  if (tier === undefined || !upstreamModel.serviceTiers.includes(tier)) {
    return null;
  }
  const wireValue = upstreamModel.provider.serviceTierValues[tier];
  return wireValue === undefined ? null : { tier, wireValue };
}

/**
 * The tier a wire value the upstream reports serving at stands for. A value
 * the Provider maps to no tier (such as `default`) means it ran without one.
 */
export function serviceTierOfWireValue(
  reportedWireValue: string,
  serviceTierValues: ServiceTierValues,
): ServiceTier | null {
  if (reportedWireValue === serviceTierValues.fast) {
    return "fast";
  }
  if (reportedWireValue === serviceTierValues.flex) {
    return "flex";
  }
  return null;
}

/**
 * The Upstream Model's prices for requests served at `tier`: the tier's own
 * prices where it has them, the standard prices for the rest.
 */
export function pricesAtServiceTier(
  upstreamModel: SnapshotUpstreamModel,
  tier: ServiceTier | null,
): UpstreamModelPrices {
  const { inputPrice, outputPrice, cacheReadPrice, cacheWritePrice } = upstreamModel;
  const standard = { inputPrice, outputPrice, cacheReadPrice, cacheWritePrice };
  return tier === null ? standard : { ...standard, ...upstreamModel.tierPrices[tier] };
}
