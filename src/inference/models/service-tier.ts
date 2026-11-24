import type { ServiceTierValues } from "@/db/schemas/index.js";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import type { ServiceTier } from "./internal-format.js";

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

export interface SentServiceTier {
  tier: ServiceTier;
  wireValue: string;
}

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
