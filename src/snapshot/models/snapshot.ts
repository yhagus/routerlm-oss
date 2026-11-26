import type { z } from 'zod';
import type { KeyCustomer } from '@/api-keys/models/api-key';
import type { StoredProviderQuirks } from '@/catalog/schemas/catalog.schema';
import type {
  AuthStyle,
  Capability,
  ModelKind,
  ParameterPolicy,
  ServiceTierValues,
  TierPrices,
  UpstreamProtocol,
} from '@/db/schemas';
import type { ServiceTier } from '@/inference/models/internal-format';
import type { WindowPricesHours } from '@/pricing-windows/models/pricing-window-activity';
import type { UpstreamModelPrices, UpstreamModelUnitPrices } from '@/usage/models/usage-job';

export interface SnapshotApiKey {
  id: string;
  name: string;
  hash: string;
  expiresAt: Date | null;
  allowedModelIds: string[];
  customer: KeyCustomer | null;
  spendLimit: number | null;
  requestRate: number | null;
}

export type SnapshotCredential =
  | { kind: 'api-key'; encryptedKey: string }
  | { kind: 'oauth-login' };

export interface SnapshotProviderAccount {
  id: string;
  name: string;
  credential: SnapshotCredential;
  priority: number;
  isEnabled: boolean;
}

export interface SnapshotEndpoint {
  kind: ModelKind;
  protocol: UpstreamProtocol;
  baseUrl: string;
}

export interface SnapshotProvider {
  id: string;
  slug: string;
  name: string;
  endpoints: SnapshotEndpoint[];
  authStyle: AuthStyle;
  quirks: z.ZodSafeParseResult<StoredProviderQuirks>;
  serviceTierValues: ServiceTierValues;
  isUsable: boolean;
  isRefusedForTermsRisk: boolean;
  providerAccounts: SnapshotProviderAccount[];
}

export function validQuirksOf(provider: SnapshotProvider): StoredProviderQuirks {
  if (!provider.quirks.success) {
    throw provider.quirks.error;
  }
  return provider.quirks.data;
}

export interface SnapshotPricingWindow extends WindowPricesHours {
  name: string;
  windowPrices: UpstreamModelPrices;
}

export interface SnapshotUpstreamModel {
  id: string;
  upstreamModelId: string;
  kind: ModelKind;
  protocols: UpstreamProtocol[];
  capabilities: Capability[];
  contextSize: number | null;
  maxOutputTokens: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  serviceTiers: ServiceTier[];
  tierPrices: Partial<Record<ServiceTier, TierPrices>>;
  pricingWindows: SnapshotPricingWindow[];
  unitPrices: UpstreamModelUnitPrices;
  sizes: string[] | null;
  maxInputImages: number | null;
  resolutions: string[] | null;
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  isEnabled: boolean;
  provider: SnapshotProvider;
}

export interface SnapshotRoute {
  id: string;
  priority: number;
  isEnabled: boolean;
  parameterPolicyOverride: ParameterPolicy | null;
  connectTimeoutMs: number | null;
  firstTokenTimeoutMs: number | null;
  totalTimeoutMs: number | null;
  upstreamModel: SnapshotUpstreamModel;
}

export function isUpstreamModelUsable(upstreamModel: SnapshotUpstreamModel): boolean {
  return upstreamModel.isEnabled && upstreamModel.provider.isUsable;
}

export function standardPricesOf(upstreamModel: SnapshotUpstreamModel): UpstreamModelPrices {
  const { inputPrice, outputPrice, cacheReadPrice, cacheWritePrice } = upstreamModel;
  return { inputPrice, outputPrice, cacheReadPrice, cacheWritePrice };
}

export function isRouteUsable(route: SnapshotRoute): boolean {
  return route.isEnabled && isUpstreamModelUsable(route.upstreamModel);
}

export interface SnapshotModel {
  id: string;
  name: string;
  kind: ModelKind;
  isEnabled: boolean;
  parameterPolicy: ParameterPolicy;
  hasAutomaticCacheBreakpoints: boolean;
  createdAt: Date;
  routes: SnapshotRoute[];
}

export interface Snapshot {
  apiKeysByKeyId: ReadonlyMap<string, SnapshotApiKey>;
  modelsByName: ReadonlyMap<string, SnapshotModel>;
  upstreamModelsById: ReadonlyMap<string, SnapshotUpstreamModel>;
  allowsPrivateUpstreams: boolean;
}

export const EMPTY_SNAPSHOT: Snapshot = {
  apiKeysByKeyId: new Map(),
  modelsByName: new Map(),
  upstreamModelsById: new Map(),
  allowsPrivateUpstreams: false,
};
