import { sendsServiceTiers } from '@/libs/models/provider-protocols';
import type { ServiceTierValues, UpstreamProtocol } from '@/db/schemas';
import type { SnapshotUpstreamModel } from '@/snapshot/models/snapshot';
import type { ServiceTier } from './internal-format';

const OPENAI_CLIENT_TIERS: ReadonlyMap<string, ServiceTier> = new Map([
  ['priority', 'fast'],
  ['fast', 'fast'],
  ['flex', 'flex'],
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
  upstreamProtocol: UpstreamProtocol,
): SentServiceTier | null {
  if (
    tier === undefined ||
    !sendsServiceTiers(upstreamProtocol) ||
    !upstreamModel.serviceTiers.includes(tier)
  ) {
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
    return 'fast';
  }
  if (reportedWireValue === serviceTierValues.flex) {
    return 'flex';
  }
  return null;
}
