import type { z } from "zod";
import type { KeyCustomer } from "@/api-keys/models/api-key.js";
import type { StoredProviderQuirks } from "@/catalog/schemas/catalog.schema.js";
import type {
  AuthStyle,
  Capability,
  ModelKind,
  ParameterPolicy,
  ServiceTierValues,
  TierPrices,
  UpstreamProtocol,
} from "@/db/schemas/index.js";
import type { ServiceTier } from "@/inference/models/internal-format.js";
import type { UpstreamModelUnitPrices } from "@/usage/models/usage-job.js";

// The in-memory copy of everything the inference path reads, so it makes no
// PostgreSQL query. Disabled rows are kept, with their flags: the inference
// path decides what to skip.

export interface SnapshotApiKey {
  /** The `api_keys` row id. */
  id: string;
  name: string;
  hash: string;
  expiresAt: Date | null;
  /** Empty means every Model (within the Integration's, for a Customer's key). */
  allowedModelIds: string[];
  /** Null for a key a User created. */
  customer: KeyCustomer | null;
  /** USD. Null means no Spend Limit. */
  spendLimit: number | null;
  /** Requests per minute. Null means no limit. */
  requestRate: number | null;
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

/** Where, and in which Protocol, a Provider serves one Model Kind (ADR 0026). */
export interface SnapshotEndpoint {
  protocol: UpstreamProtocol;
  baseUrl: string;
}

export interface SnapshotProvider {
  id: string;
  slug: string;
  /** The display name, which Attempts copy for the Error Captures list. */
  name: string;
  /** Where the Provider serves each Model Kind; a Kind it has no endpoint for is missing. */
  endpoints: Partial<Record<ModelKind, SnapshotEndpoint>>;
  authStyle: AuthStyle;
  /** Validated once, when the snapshot loads: read them with `validQuirksOf`. */
  quirks: z.ZodSafeParseResult<StoredProviderQuirks>;
  serviceTierValues: ServiceTierValues;
  /** Enabled, and allowed by the terms-risk Setting when the Provider has a Terms Risk. */
  isUsable: boolean;
  /** A Terms Risk Provider while the terms-risk Setting is off: not even a Probe may call it. */
  isRefusedForTermsRisk: boolean;
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
  kind: ModelKind;
  capabilities: Capability[];
  /** Null for a media Kind, which has no token context. */
  contextSize: number | null;
  maxOutputTokens: number | null;
  /** USD per million tokens; null when unpublished. */
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  serviceTiers: ServiceTier[];
  tierPrices: Partial<Record<ServiceTier, TierPrices>>;
  /** A media Kind's prices per counted unit. */
  unitPrices: UpstreamModelUnitPrices;
  /** Image sizes as the Provider writes them (`1024*1024`); null when any size goes. */
  sizes: string[] | null;
  /** Null when no limit is known. */
  maxInputImages: number | null;
  /** Video resolutions, such as `720P`; null when any goes. */
  resolutions: string[] | null;
  /** A video's shortest and longest duration in seconds; null when no limit is known. */
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
  /** Null means the gateway default. */
  connectTimeoutMs: number | null;
  firstTokenTimeoutMs: number | null;
  totalTimeoutMs: number | null;
  upstreamModel: SnapshotUpstreamModel;
}

export interface SnapshotModel {
  id: string;
  name: string;
  kind: ModelKind;
  isEnabled: boolean;
  parameterPolicy: ParameterPolicy;
  hasAutomaticCacheBreakpoints: boolean;
  createdAt: Date;
  /** In the order they are tried: priority, then creation. Only those to an Upstream Model of its Kind. */
  routes: SnapshotRoute[];
}

export interface Snapshot {
  /** Live API Keys by their public key id: neither revoked nor issued by a disabled Integration. */
  apiKeysByKeyId: ReadonlyMap<string, SnapshotApiKey>;
  modelsByName: ReadonlyMap<string, SnapshotModel>;
  /** By row id, including those no Route uses: a direct Upstream Model test reaches them all. */
  upstreamModelsById: ReadonlyMap<string, SnapshotUpstreamModel>;
  /** The Allow private upstreams Setting (ADR 0019). */
  allowsPrivateUpstreams: boolean;
}

export const EMPTY_SNAPSHOT: Snapshot = {
  apiKeysByKeyId: new Map(),
  modelsByName: new Map(),
  upstreamModelsById: new Map(),
  allowsPrivateUpstreams: false,
};
