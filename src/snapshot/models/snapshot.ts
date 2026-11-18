import type { z } from "zod";
import type { StoredProviderQuirks } from "@/catalog/schemas/catalog.schema.js";
import type {
  AuthStyle,
  Capability,
  ParameterPolicy,
  ServiceTierValues,
  TierPrices,
  UpstreamProtocol,
} from "@/db/schemas/index.js";
import type { ServiceTier } from "@/inference/models/internal-format.js";

// The in-memory copy of everything the inference path reads, so it makes no
// PostgreSQL query. Disabled rows are kept, with their flags: the inference
// path decides what to skip.

export interface SnapshotApiKey {
  /** The `api_keys` row id. */
  id: string;
  name: string;
  hash: string;
  expiresAt: Date | null;
  /** Empty means every Model. */
  allowedModelIds: string[];
}

/** Which credential a Provider Account holds, and what of it the inference path keeps in memory. */
export type SnapshotCredential =
  /** Still encrypted: decrypt with ProviderKeyCipher only for the Attempt that uses it. */
  | { kind: "api-key"; encryptedKey: string }
  /** An OAuth Login's tokens rotate, so each Attempt reads them where they are stored. */
  | { kind: "oauth-login" };

export interface SnapshotProviderAccount {
  id: string;
  name: string;
  credential: SnapshotCredential;
  priority: number;
  isEnabled: boolean;
}

export interface SnapshotProvider {
  id: string;
  slug: string;
  /** The display name, which Attempts copy for the Error Captures list. */
  name: string;
  protocol: UpstreamProtocol;
  baseUrl: string;
  authStyle: AuthStyle;
  /** Validated once, when the snapshot loads: read them with `validQuirksOf`. */
  quirks: z.ZodSafeParseResult<StoredProviderQuirks>;
  serviceTierValues: ServiceTierValues;
  /** Enabled, and allowed by the terms-risk Setting when the Provider has a Terms Risk. */
  isUsable: boolean;
  /** Lowest priority first. */
  providerAccounts: SnapshotProviderAccount[];
}

/**
 * The Provider's quirks. Stored quirks that don't validate throw their
 * validation error here, so they fail only the requests that use the
 * Provider, never the snapshot load.
 */
export function validQuirksOf(provider: SnapshotProvider): StoredProviderQuirks {
  if (!provider.quirks.success) {
    throw provider.quirks.error;
  }
  return provider.quirks.data;
}

export interface SnapshotUpstreamModel {
  id: string;
  upstreamModelId: string;
  capabilities: Capability[];
  contextSize: number;
  maxOutputTokens: number | null;
  /** USD per million tokens; null when unpublished. */
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  serviceTiers: ServiceTier[];
  tierPrices: Partial<Record<ServiceTier, TierPrices>>;
  isEnabled: boolean;
  provider: SnapshotProvider;
}

export interface SnapshotRoute {
  id: string;
  priority: number;
  isEnabled: boolean;
  parameterPolicyOverride: ParameterPolicy | null;
  /** Null means the gateway default. */
  connectTimeoutMs: number | null;
  firstTokenTimeoutMs: number | null;
  totalTimeoutMs: number | null;
  upstreamModel: SnapshotUpstreamModel;
}

export interface SnapshotModel {
  id: string;
  name: string;
  isEnabled: boolean;
  parameterPolicy: ParameterPolicy;
  hasAutomaticCacheBreakpoints: boolean;
  createdAt: Date;
  /** In the order they are tried: priority, then creation. */
  routes: SnapshotRoute[];
}

export interface Snapshot {
  /** Live (unrevoked) API Keys by their public key id. */
  apiKeysByKeyId: ReadonlyMap<string, SnapshotApiKey>;
  modelsByName: ReadonlyMap<string, SnapshotModel>;
  /** By row id, including those no Route uses: a direct Upstream Model test reaches them all. */
  upstreamModelsById: ReadonlyMap<string, SnapshotUpstreamModel>;
}

export const EMPTY_SNAPSHOT: Snapshot = {
  apiKeysByKeyId: new Map(),
  modelsByName: new Map(),
  upstreamModelsById: new Map(),
};
