import type { Runtime } from "../../runtime";
import type { ProviderConnection } from "../../db/repositories";
import { getProviderRegistryEntry } from "../providers/providerCatalog";
import { checkFallbackError, isModelLockActive } from "./accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "../providers/config/errorConfig.ts";
import { GROK_CLI_FREE_USAGE_WINDOW_MS } from "../providers/config/grokCli.ts";
import { parseGrokCliFreeUsageTokens } from "../billing/usage/grok-cli.js";
import { getCodeBuddyIntlCliUsage } from "../billing/usage/codebuddy.js";
import { laterUntil, storedConnection, unavailableUntil } from "./fallback";
import { connectionInFlight, connectionInFlightLimit, type SlotOwner } from "./inFlightSlots";
import { affinityEnabled, freeHome, rememberHome, type AffinityKeys } from "./sessionAffinity";
import { ALIMS_EXHAUSTED_MARKER_PREFIX, alimsExhaustedMarkerKey, isAlimsFreeTierExhausted, isAlimsModelExhausted } from "../providers/alimsFreeTier.js";
import { CODEBUDDY_RESTRICTED_MARKER, codebuddyRestrictedAt, isCodebuddyAccountRestricted } from "../providers/codebuddyRestricted";
import {
  applyGrokCliFamilyExhaustion,
  clearAllGrokCliFamilyExhaustion,
  clearGrokCliFamilyExhaustion,
  grokCliQuotaFamily,
  grokCliFamilyExhaustedUntil,
  hasGrokCliFamilyMarker,
  isGrokCliFamilyExhausted,
  isGrokCliFreeUsageExhausted,
  parseGrokCliQuotaFamilyFromError,
} from "../providers/grokCliQuotaFamily.js";

// Codex flagship models that free-plan accounts cannot serve. The review
// variant shares the same upstream model, so it carries the same gate. This
// hardcoded set is the fail-safe fallback when settings are missing or the
// configured list is not an array.
const DEFAULT_CODEX_FREE_BLOCKED_MODELS = new Set(["gpt-5.6-sol", "gpt-5.6-sol-review"]);

// Resolve the configured codex plan→model allowlist from runtime settings.
// When planModelMap is present and non-empty, it is authoritative:
//   { "free": ["model-a", ...], "plus": ["model-b", ...] }
// A plan key maps to the set of models that plan CAN serve (allowlist).
// Plans not in the map serve all models (fail-open).
// Returns null when absent so the caller can fall back to legacy logic.
function codexPlanModelMap(runtime: Runtime): Record<string, Set<string>> | null {
  try {
    const settings = runtime.repos.settings.get() as Record<string, any>;
    const configured = settings?.codex?.planModelMap;
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) return null;
    const result: Record<string, Set<string>> = {};
    for (const [plan, models] of Object.entries(configured as Record<string, unknown>)) {
      if (Array.isArray(models) && models.every((m) => typeof m === "string")) {
        result[plan.trim().toLowerCase()] = new Set(models as string[]);
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

// Resolve the configured codex per-model fallback chains from runtime settings.
// When a model is unavailable on every account that may serve it, the router
// retries the request with the next model in its list. Order is priority.
//   { "gpt-5.6-sol": ["gpt-5.6-terra", ...] }
// Keys and entries are normalized to bare model ids. Returns {} when absent or
// invalid, so callers can treat "no fallbacks" as the default.
export function codexModelFallbacks(runtime: Runtime): Record<string, string[]> {
  try {
    const settings = runtime.repos.settings.get() as Record<string, any>;
    const configured = settings?.codex?.modelFallbacks;
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) return {};
    const result: Record<string, string[]> = {};
    for (const [model, fallbacks] of Object.entries(configured as Record<string, unknown>)) {
      const key = bareModelId(model.trim());
      if (!key) continue;
      if (!Array.isArray(fallbacks)) continue;
      const list = fallbacks
        .filter((m): m is string => typeof m === "string")
        .map((m) => bareModelId(m.trim()))
        .filter((m) => m.length > 0 && m !== key);
      if (list.length > 0) result[key] = list;
    }
    return result;
  } catch {
    return {};
  }
}

// Fallback models for one codex model, in priority order. Empty when none.
export function codexFallbackModelsFor(runtime: Runtime, model: string | null | undefined): string[] {
  if (!model) return [];
  const map = codexModelFallbacks(runtime);
  return map[bareModelId(model)] || [];
}

// Legacy: resolve the free-blocked-models set from settings.
function codexLegacyFreeBlockedModels(runtime: Runtime): Set<string> {
  try {
    const settings = runtime.repos.settings.get() as Record<string, any>;
    const configured = settings?.codex?.freeBlockedModels;
    if (Array.isArray(configured) && configured.every((id) => typeof id === "string")) {
      return new Set(configured as string[]);
    }
  } catch { /* fall through to default */ }
  return DEFAULT_CODEX_FREE_BLOCKED_MODELS;
}

function bareModelId(model: string): string {
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

// Resolve a Codex account plan: fresh quota snapshot first, OAuth-stored
// plan type as fallback. Returns null when unknown (fail open).
function codexPlanOf(runtime: Runtime, connection: ProviderConnection): string | null {
  try {
    const payload = runtime.quotaSnapshots.getPayload(connection.id) as Record<string, unknown> | null;
    const snapshotPlan = payload && typeof payload.plan === "string" ? payload.plan : null;
    if (snapshotPlan && snapshotPlan.trim()) return snapshotPlan.trim().toLowerCase();
  } catch { /* fall through to stored plan */ }
  const stored = (connection.data as Record<string, unknown> | undefined)?.chatgptPlanType;
  return typeof stored === "string" && stored.trim() ? stored.trim().toLowerCase() : null;
}

// True when a Codex account's plan allows serving this model.
// Unknown plans and plans not in the map are allowed (fail-open).
// When planModelMap is configured, each plan key is an allowlist:
//   the plan can ONLY serve models in the set.
// When planModelMap is absent, falls back to the legacy freeBlockedModels
// blocklist: only the "free" plan is blocked from serving those models.
export function isCodexModelAllowedForPlan(runtime: Runtime, connection: ProviderConnection, model: string | null | undefined): boolean {
  if (connection.provider !== "codex" || !model) return true;
  const plan = codexPlanOf(runtime, connection);
  if (!plan) return true;
  const map = codexPlanModelMap(runtime);
  if (map) {
    // Allowlist mode: plan must be in the map AND model in the plan's set.
    const allowed = map[plan];
    if (!allowed) return true; // plan not in map → allow all
    return allowed.has(bareModelId(model));
  }
  // Legacy blocklist mode: free plan is blocked from freeBlockedModels.
  if (plan !== "free") return true;
  return !codexLegacyFreeBlockedModels(runtime).has(bareModelId(model));
}

// codebuddy-intl-cli Exhausted Excluded Models. Every model on one CodeBuddy
// account shares a single upstream quota, so an exhausted model must lock the
// whole account (modelLock___all) instead of just itself. Operators list model
// ids that stay independent: those keep their own per-model cooldown and never
// inherit the account-wide lock. Reads the configured list fail-safe (missing
// or malformed settings fall back to an empty set).
export function codebuddyExhaustedExcludedModels(runtime: Runtime): Set<string> {
  const raw = (runtime.repos.settings.get() as Record<string, any>)?.codebuddyIntlCli?.exhaustedExcludedModels;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map((model) => String(model).trim()).filter(Boolean));
}

// True when a codebuddy-intl-cli connection carries an active account-wide lock
// (modelLock___all) that should skip this model. Excluded models bypass it so
// their independent cooldown wins.
export function isCodebuddyAccountLockSkipped(runtime: Runtime, connectionData: Record<string, unknown>, model: string | null | undefined): boolean {
  const allLock = connectionData?.modelLock___all;
  if (!allLock) return false;
  if (new Date(String(allLock)).getTime() <= Date.now()) return false;
  if (!model) return true;
  return !codebuddyExhaustedExcludedModels(runtime).has(model);
}

// codebuddy-intl-cli "priority meter" gate. When an operator configures a
// preferred meter (e.g. "Monthly") this returns true for a connection where
// that meter is exhausted BUT some other meter (Bonus Pack N, etc.) still has
// balance — such a connection must yield to accounts that still have the
// priority meter available. Fail-open on missing/error snapshots so a fresh
// connection is never wrongly skipped.
export function isCodebuddyPriorityMeterExhaustedButOthersRemain(
  runtime: Runtime,
  connectionId: string,
  meterName: string,
): boolean {
  if (!meterName) return false;
  const snapshot = runtime.quotaSnapshots.getSnapshot(connectionId);
  if (!snapshot || snapshot.status !== "ready") return false;
  const quotas = (snapshot.payload as { quotas?: Record<string, { used?: number; total?: number; unlimited?: boolean }> } | null)?.quotas;
  if (!quotas || typeof quotas !== "object") return false;
  const priority = quotas[meterName];
  if (!priority) return false;
  const priorityTotal = Number(priority.total);
  const priorityUsed = Number(priority.used);
  const priorityUnlimited = priority.unlimited === true;
  if (priorityUnlimited) return false;
  if (!Number.isFinite(priorityTotal) || priorityTotal <= 0) return false;
  if (!Number.isFinite(priorityUsed) || priorityUsed < priorityTotal) return false;
  // Priority meter is exhausted. Only skip when at least one other meter has balance.
  for (const [name, meter] of Object.entries(quotas)) {
    if (name === meterName) continue;
    if (!meter) continue;
    if (meter.unlimited === true) return true;
    const total = Number(meter.total);
    const used = Number(meter.used);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(used) && used < total) return true;
  }
  return false;
}

// v1 keeps provider-specific extras in a nested providerSpecificData object on
// the connection; v2-native rows keep the same fields flat in the data bag.
// Seeded/imported v1 rows carry the nested copy, and the v1 executors/adapters
// read e.g. qoder's personalAccessToken or userId from there — so the nested
// object must win whenever it exists.
export function resolveV1ProviderSpecificData(data: Record<string, any> | null | undefined): Record<string, any> {
  const nested = data?.providerSpecificData;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  return (data as Record<string, any>) || {};
}

const BITDEER_EXHAUSTED_MARKER = "bitdeerExhaustedAt";

export function isBitdeerInsufficientBalance(provider: string, status: number, errorText: string): boolean {
  if (provider !== "bitdeer") return false;
  if (status !== 402) return false;
  return /insufficient.?balance/i.test(errorText);
}

export function bitdeerExhaustedUntil(data: Record<string, unknown>): string | null {
  const exhaustedAt = data?.[BITDEER_EXHAUSTED_MARKER];
  if (!exhaustedAt) return null;
  const ts = new Date(String(exhaustedAt)).getTime();
  return Number.isFinite(ts) ? new Date(String(exhaustedAt)).toISOString() : null;
}

export { isGrokCliFreeUsageExhausted };

export function grokCliExhaustedUntil(data: Record<string, unknown>, model?: string | null): string | null {
  return grokCliFamilyExhaustedUntil(data, model);
}

export interface SelectedConnection {
  connection: ProviderConnection;
  credentials: Record<string, any>;
  synthetic: boolean;
}

export interface ConnectionSelection {
  selected: SelectedConnection | null;
  remaining: number;
  // True when eligible Connections exist but each one is at its in-flight limit.
  saturated?: boolean;
}

// Root resolveConnectionProxyConfig: an active proxy pool takes precedence
// over legacy per-connection settings; relay pools use the shared relay field.
export function resolveConnectionProxyConfig(runtime: Pick<Runtime, "repos">, providerSpecificData: Record<string, any> = {}): Record<string, any> {
  const normalize = (value: unknown) => String(value ?? "").trim();
  const proxyPoolIdRaw = normalize(providerSpecificData.proxyPoolId);
  const proxyPoolId = proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;
  const legacy = {
    connectionProxyEnabled: providerSpecificData.connectionProxyEnabled === true,
    connectionProxyUrl: normalize(providerSpecificData.connectionProxyUrl),
    connectionNoProxy: normalize(providerSpecificData.connectionNoProxy),
    strictProxy: providerSpecificData.strictProxy === true,
  };
  if (proxyPoolId) {
    const row = runtime.repos.proxies.get(proxyPoolId) as Record<string, any> | null;
    let pool = row;
    if (typeof row?.data === "string") {
      try { pool = { ...row, ...JSON.parse(row.data) }; } catch { /* use raw row */ }
    }
    const proxyUrl = normalize(pool?.proxyUrl);
    const noProxy = normalize(pool?.noProxy);
    const active = pool?.isActive === true || pool?.isActive === 1;
    if (pool && active && proxyUrl) {
      if (["vercel", "cloudflare", "deno"].includes(String(pool.type))) {
        return { proxyPoolId, connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: noProxy, strictProxy: pool.strictProxy === true, vercelRelayUrl: proxyUrl };
      }
      return { proxyPoolId, connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, connectionNoProxy: noProxy, strictProxy: pool.strictProxy === true, vercelRelayUrl: "" };
    }
  }
  return { proxyPoolId: proxyPoolId || null, ...legacy, vercelRelayUrl: "" };
}

// Executor Credentials for a stored Connection. Chat selection and the
// refresh coordinator build the same shape from the same row.
export function connectionCredentials(runtime: Pick<Runtime, "repos">, connection: ProviderConnection): Record<string, any> {
  return {
    ...connection.data,
    authType: connection.authType,
    providerSpecificData: {
      ...resolveV1ProviderSpecificData(connection.data),
      // Root executors read compatible endpoint overrides from the nested
      // providerSpecificData shape. v2's normalized row also has a top-
      // level baseUrl, so thread it through instead of silently falling
      // back to the provider registry URL.
      ...(connection.baseUrl || connection.data.baseUrl ? { baseUrl: connection.baseUrl || connection.data.baseUrl } : {}),
      ...resolveConnectionProxyConfig(runtime, resolveV1ProviderSpecificData(connection.data)),
    },
    baseUrl: connection.baseUrl ?? connection.data.baseUrl ?? null,
    connectionId: connection.id,
    connectionName: connection.name || connection.email || connection.id,
  };
}

// v1 proxyOptions: per-connection proxy routing flags read by proxyAwareFetch.
export function connectionProxyOptions(credentials: Record<string, any>): Record<string, unknown> {
  const psd = credentials?.providerSpecificData || {};
  return {
    connectionProxyEnabled: psd.connectionProxyEnabled === true,
    connectionProxyUrl: psd.connectionProxyUrl || "",
    connectionNoProxy: psd.connectionNoProxy || "",
    strictProxy: psd.strictProxy === true,
    vercelRelayUrl: psd.vercelRelayUrl || "",
  };
}

// The Connections below their in-flight limit (the Connection's own
// data.maxInFlight, else providerStrategies[provider].maxInFlightPerConnection).
// `saturated` is true when the limit removed every Connection.
export function connectionsWithFreeSlots(
  owner: SlotOwner,
  settings: Record<string, any>,
  _provider: string,
  connections: ProviderConnection[],
): { connections: ProviderConnection[]; saturated: boolean } {
  const free = connections.filter((connection) => {
    const limit = connectionInFlightLimit(settings, connection);
    return limit === null || connectionInFlight(owner, connection.id) < limit;
  });
  return { connections: free, saturated: connections.length > 0 && free.length === 0 };
}

// v1 getProviderCredentials semantics: noAuth providers get a synthetic
// connection, locked accounts are skipped, and ordering honors the provider
// strategy (fill-first or sticky round-robin) plus combo account filters.
export function selectChatConnection(
  runtime: Runtime,
  provider: string,
  options: { model?: string | null; excludeIds?: Set<string>; allowedIds?: string[] | null; preferredId?: string | null; accountOrder?: string[] | null; affinity?: AffinityKeys | null } = {} as any,
): ConnectionSelection {
  const excludeIds = options.excludeIds || new Set<string>();
  const entry = getProviderRegistryEntry(provider);
  const active = new Set<string>((options.allowedIds || []).map((id) => String(id)));

  const noAuth = entry?.noAuth || (entry?.transport as Record<string, unknown> | undefined)?.noAuth === true;
  const publicSelection = (): ConnectionSelection => ({
    selected: {
      connection: {
        id: "noauth",
        provider,
        authType: "none",
        name: "Public",
        email: null,
        priority: 0,
        isActive: true,
        apiType: null,
        baseUrl: null,
        credentials: {} as Record<string, any>,
        data: { accessToken: "public" },
        createdAt: "",
        updatedAt: "",
      },
      credentials: { authType: "none", accessToken: "public", connectionId: "noauth", connectionName: "Public", providerSpecificData: resolveConnectionProxyConfig(runtime) },
      synthetic: true,
    },
    remaining: 0,
  });
  // noAuth providers can still hold optional accounts (an OpenCode API key for
  // paid models). Those win; the public connection serves when none is usable.
  if (noAuth && (options.preferredId === "noauth" || runtime.repos.providers.select(provider).length === 0)) return publicSelection();

  const baseConnections = runtime.repos.providers.select(provider).filter((connection) => {
    if (excludeIds.has(connection.id)) return false;
    if (active.size > 0 && !active.has(connection.id)) return false;
    if (options.model) {
      const data = { ...connection.data } as Record<string, unknown>;
      if (provider === "codebuddy-intl-cli") {
        // codebuddy-intl-cli shares one upstream quota across models. An
        // exhausted sibling writes an account-wide lock; only configured
        // excluded models bypass it and keep their own per-model lock.
        const modelKey = `modelLock_${options.model}`;
        const ownExpiry = data[modelKey] ? new Date(String(data[modelKey])).getTime() : 0;
        if (ownExpiry > Date.now()) return false;
        if (isCodebuddyAccountLockSkipped(runtime, data, options.model)) return false;
      } else if (isModelLockActive(data, options.model)) {
        return false;
      }
    }
    // Alibaba Studio free-tier exhaustion is per-model and sticky: skip the
    // account for that model until a success or an explicit reset clears it.
    if (options.model && isAlimsModelExhausted(connection.data as Record<string, unknown>, options.model)) return false;
    // Codex plan-based model gating: when planModelMap is configured, each
    // plan can only serve its allowlisted models. When absent, falls back to
    // the legacy freeBlockedModels blocklist (free plan only).
    if (options.model && !isCodexModelAllowedForPlan(runtime, connection, options.model)) return false;
    if (isGrokCliFamilyExhausted(connection.data as Record<string, unknown>, options.model)) return false;
    // Bitdeer accounts with a 402 "insufficient balance" are sticky-exhausted
    // until a successful request or manual reset clears the marker.
    if (bitdeerExhaustedUntil(connection.data as Record<string, unknown>)) return false;
    // CodeBuddy accounts restricted for unusual activity stay out of rotation
    // until a manual reset; the daily probe still refreshes their token.
    if (codebuddyRestrictedAt(connection.data as Record<string, unknown>)) return false;
    return true;
  });

  // codebuddy-intl-cli "priority meter": prefer accounts whose configured
  // priority meter (e.g. "Monthly") still has balance. Fall back to the full
  // set only when every otherwise-eligible account has already drained the
  // priority meter, so leftover Bonus Pack credits still get used at the end.
  const priorityMeterRaw = provider === "codebuddy-intl-cli"
    ? (runtime.repos.settings.get() as Record<string, any>)?.codebuddyIntlCli?.priorityMeter
    : null;
  const priorityMeter = typeof priorityMeterRaw === "string" && priorityMeterRaw.trim() ? priorityMeterRaw.trim() : null;
  let connections = baseConnections;
  if (priorityMeter) {
    const strict = baseConnections.filter((connection) => !isCodebuddyPriorityMeterExhaustedButOthersRemain(runtime, connection.id, priorityMeter));
    if (strict.length > 0) connections = strict;
  }

  // An explicit x-connection-id pin wins over session affinity.
  let pinned = false;
  if (options.preferredId) {
    const preferred = connections.find((connection) => connection.id === options.preferredId);
    if (preferred) {
      pinned = true;
      connections = [preferred, ...connections.filter((connection) => connection.id !== options.preferredId)];
    }
  }

  // v1 sortConnectionsByOrder: combos with custom account order pin the try
  // order; unknown ids sort last by priority.
  if (Array.isArray(options.accountOrder) && options.accountOrder.length > 0) {
    const orderIndex = new Map(options.accountOrder.map((id, index) => [id, index]));
    connections = [...connections].sort((left, right) => {
      const li = orderIndex.has(left.id) ? orderIndex.get(left.id)! : Infinity;
      const ri = orderIndex.has(right.id) ? orderIndex.get(right.id)! : Infinity;
      return li !== ri ? li - ri : (left.priority || 999) - (right.priority || 999);
    });
  }

  if (connections.length === 0) return noAuth && !excludeIds.has("noauth") ? publicSelection() : { selected: null, remaining: 0 };

  const settings = runtime.repos.settings.get() as Record<string, any>;
  // A Connection at its in-flight limit is not eligible. Fill-first then
  // picks the first Connection with free capacity, and round-robin rotates
  // only through Connections with free capacity.
  const eligibleIds = new Set(connections.map((connection) => connection.id));
  const free = connectionsWithFreeSlots(runtime, settings, provider, connections);
  if (free.saturated) return { selected: null, remaining: 0, saturated: true };
  connections = free.connections;
  const strategy = settings.providerStrategies?.[provider]?.fallbackStrategy || settings.fallbackStrategy || "fill-first";
  const affinity = !pinned && options.affinity && affinityEnabled(settings, provider) ? options.affinity : null;
  const home = affinity ? freeHome(affinity, connections) : null;
  let chosen = home ?? connections[0];

  // A free home skips the strategy, so round-robin state moves only for
  // requests that the strategy places.
  if (!home && strategy === "round-robin") {
    // Sticky rotation: keep using the most recently used eligible account
    // until its consecutive-use budget is spent, then advance to the next
    // eligible account in order, wrapping to the first after the last.
    const stickyLimit = Number(settings.stickyRoundRobinLimit ?? settings.comboStickyRoundRobinLimit ?? 3) || 3;
    const usedAt = (connection: ProviderConnection) => new Date(String(connection.data.lastUsedAt || 0)).getTime() || 0;
    let recentIndex = 0;
    for (let index = 1; index < connections.length; index += 1) {
      if (usedAt(connections[index]) > usedAt(connections[recentIndex])) recentIndex = index;
    }
    const recent = connections[recentIndex];
    const recentCount = usedAt(recent) > 0 ? Number(recent.data.consecutiveUseCount || 0) : 0;
    chosen = recentCount < stickyLimit ? recent : connections[(recentIndex + 1) % connections.length];
    // Keep lastUsedAt strictly increasing so two picks in the same
    // millisecond still order correctly on the next selection.
    const now = Math.max(Date.now(), usedAt(recent) + 1);
    runtime.repos.providers.noteUse(chosen.id, {
      lastUsedAt: new Date(now).toISOString(),
      consecutiveUseCount: chosen.id === recent.id ? recentCount + 1 : 1,
    });
  }
  if (affinity) rememberHome(affinity, eligibleIds, chosen.id);

  return {
    selected: {
      connection: chosen,
      credentials: connectionCredentials(runtime, chosen),
      synthetic: false,
    },
    remaining: connections.length - 1,
  };
}

// Ceiling for a quota-meter-derived reset. The dynamic reset can legitimately
// be hours-to-days (a real refill CycleEndTime), far beyond the 30-minute
// MAX_RATE_LIMIT_COOLDOWN_MS used for transient 429s — so it gets its own cap.
// 14 days stops a stuck or far-future meter from locking an account forever.
const MAX_QUOTA_RESET_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

// codebuddy-intl-cli fallback cooldown: used only when the quota API returns no
// usable resetAt timestamp (probe failed, no meters, or exhausted meters with no
// resetAt). The real cooldown is derived from the soonest exhausted meter resetAt.
const CODEBUDDY_INTL_CLI_FALLBACK_COOLDOWN_MS = 5 * 60 * 1000;

// codebuddy-intl-cli only: return the soonest resetAt epoch-ms among meters
// that are exhausted (used >= total). Meters with remaining balance are ignored
// — a transient 429 on one meter must not lock past another meter's refill.
// Reads the stored quota snapshot first (fast path); falls back to a fresh API
// probe when the snapshot has no usable data. Returns null when no exhausted
// meter has a valid future resetAt.
async function codebuddyExhaustedResetMs(runtime: Runtime, connection: ProviderConnection): Promise<number | null> {
  const meterResetFrom = (quotas: Record<string, { used?: number; total?: number; resetAt?: string | null }> | undefined): number | null => {
    const meters = Object.values(quotas || {});
    if (meters.length === 0) return null;
    const now = Date.now();
    const exhaustedResets = meters
      .filter((m) => {
        const total = Number(m?.total);
        const used = Number(m?.used);
        return Number.isFinite(total) && total > 0 && Number.isFinite(used) && used >= total;
      })
      .map((m) => (m?.resetAt ? new Date(String(m.resetAt)).getTime() : NaN))
      .filter((ms) => Number.isFinite(ms) && ms > now);
    if (exhaustedResets.length === 0) return null;
    return Math.min(...exhaustedResets);
  };

  // Fast path: read the stored quota snapshot (updated by the quota refresh loop).
  const snapshot = runtime.quotaSnapshots.getPayload(connection.id);
  const snapshotReset = meterResetFrom((snapshot as { quotas?: Record<string, { used?: number; total?: number; resetAt?: string | null }> })?.quotas);
  if (snapshotReset) return snapshotReset;

  // Slow path: probe the live quota API when the snapshot has no usable resetAt.
  try {
    const data = (connection.data ?? {}) as Record<string, any>;
    const psd = resolveV1ProviderSpecificData(data);
    const proxyOptions = resolveConnectionProxyConfig(runtime, psd);
    const token = data.accessToken || data.apiKey || connection.credentials?.accessToken || connection.credentials?.apiKey;
    if (!token) return null;
    const usage = await getCodeBuddyIntlCliUsage(data.accessToken, data.apiKey, psd, proxyOptions) as {
      quotas?: Record<string, { used?: number; total?: number; resetAt?: string | null }>;
    };
    return meterResetFrom(usage?.quotas);
  } catch {
    return null;
  }
}

// v1 markAccountUnavailable (src/sse/services/auth.js): classify the failure,
// lock the model (or the account via modelLock___all) with the cooldown, and
// persist a sparse error patch. grok-cli free-usage exhaustion probes the
// credits endpoint for a precise reset timestamp instead of using backoff.
// disableAccount (e.g. Qoder 403 quota) also deactivates the connection.
// Non-fallback failures never lock the account.
export async function markAccountUnavailable(
  runtime: Runtime,
  connection: ProviderConnection,
  status: number,
  errorText: string,
  provider: string,
  model?: string | null,
  resetsAtMs?: number | null,
  disableAccount = false,
  upstreamCode?: string | null,
): Promise<boolean> {
  const grokCliFreeUsageExhausted = isGrokCliFreeUsageExhausted(provider, status, errorText);
  const alimsFreeTierExhausted = isAlimsFreeTierExhausted(provider, status, upstreamCode);
  const bitdeerBalanceExhausted = isBitdeerInsufficientBalance(provider, status, errorText);
  const codebuddyRestricted = isCodebuddyAccountRestricted(provider, upstreamCode);
  const grokCliFamily = grokCliFreeUsageExhausted
    ? parseGrokCliQuotaFamilyFromError(errorText) || grokCliQuotaFamily(model)
    : null;
  const grokCliFreeUsageTokens = grokCliFreeUsageExhausted
    ? parseGrokCliFreeUsageTokens(errorText) as { used: number; limit: number } | null
    : null;

  // Classify against a backoff level. The first pass decides whether the
  // failure falls back; the write uses the level stored at write time.
  const classify = (backoffLevel: number): { shouldFallback: boolean; cooldownMs: number; newBackoffLevel?: number } => {
    if (grokCliFreeUsageExhausted) return { shouldFallback: true, cooldownMs: GROK_CLI_FREE_USAGE_WINDOW_MS, newBackoffLevel: 0 };
    // Bitdeer 402 "insufficient balance" — sticky exhaustion, no auto-retry.
    if (bitdeerBalanceExhausted) return { shouldFallback: true, cooldownMs: MAX_RATE_LIMIT_COOLDOWN_MS, newBackoffLevel: 0 };
    return checkFallbackError(status, errorText, backoffLevel) as { shouldFallback: boolean; cooldownMs: number; newBackoffLevel?: number };
  };
  if (!classify(0).shouldFallback) return false;

  // codebuddy-intl-cli 429: derive the cooldown from the soonest exhausted
  // meter resetAt (the real refill wait). Only when the quota API has no
  // usable resetAt (probe failed, no meters, or exhausted meters with no
  // resetAt) does the 5-minute fallback apply.
  if (provider === "codebuddy-intl-cli" && status === 429 && !(resetsAtMs && resetsAtMs > Date.now())) {
    const dynamicResetMs = await codebuddyExhaustedResetMs(runtime, connection);
    if (dynamicResetMs) {
      resetsAtMs = Math.min(dynamicResetMs, Date.now() + MAX_QUOTA_RESET_COOLDOWN_MS);
    } else {
      resetsAtMs = Date.now() + CODEBUDDY_INTL_CLI_FALLBACK_COOLDOWN_MS;
    }
  }

  // Read the stored row now, after every await. The selection-time copy can
  // hold an older backoff level or an older lock.
  const stored = storedConnection(runtime.repos, connection);
  const storedData = stored.data as Record<string, unknown>;
  const storedLevel = Number(storedData.backoffLevel || 0);
  const { cooldownMs, newBackoffLevel } = classify(storedLevel);
  const until = resetsAtMs && resetsAtMs > Date.now() ? new Date(resetsAtMs).toISOString() : unavailableUntil(cooldownMs);
  // CodeBuddy models share one account quota. A non-excluded model exhausting
  // the account locks every model (modelLock___all); configured excluded models
  // keep an independent per-model lock. Other providers lock just the model.
  const codebuddyModelExcluded = provider === "codebuddy-intl-cli" && model != null
    && codebuddyExhaustedExcludedModels(runtime).has(model);
  const lockKey = provider === "codebuddy-intl-cli"
    ? (codebuddyModelExcluded ? `modelLock_${model}` : "modelLock___all")
    : (model ? `modelLock_${model}` : "modelLock___all");
  const data: Record<string, unknown> = {
    [lockKey]: laterUntil(storedData[lockKey], until),
    testStatus: "unavailable",
    lastError: String(errorText).slice(0, 100),
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? storedLevel,
  };
  if (grokCliFreeUsageExhausted && grokCliFamily) {
    Object.assign(data, changedFields(storedData, applyGrokCliFamilyExhaustion(storedData, grokCliFamily, grokCliFreeUsageTokens)));
  }
  if (alimsFreeTierExhausted) {
    // Sticky per-model marker. Free-tier quota does not reset on a timer, so it
    // stays until a request for the same model succeeds or an operator resets it.
    data[alimsExhaustedMarkerKey(model)] = true;
  }
  if (bitdeerBalanceExhausted) {
    // Sticky exhaustion marker — cleared on next success or manual reset.
    data[BITDEER_EXHAUSTED_MARKER] = new Date().toISOString();
  }
  if (codebuddyRestricted) {
    // Sticky until a manual reset or a successful request clears it.
    data[CODEBUDDY_RESTRICTED_MARKER] = new Date().toISOString();
  }
  runtime.repos.providers.patch(connection.id, disableAccount ? { data, isActive: false } : { data });
  return true;
}

// Fields of `next` that differ from `current`, as a Connection patch. A field
// that `next` drops becomes `null`, which the patch removes.
function changedFields(current: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(value) !== JSON.stringify(current[key])) changes[key] = value ?? null;
  }
  for (const key of Object.keys(current)) if (!(key in next)) changes[key] = null;
  return changes;
}

// v1 clearAccountError (src/sse/services/auth.js): sparse patch only. Clears
// the succeeded model's lock plus expired locks; resets the error state (to
// "active") only when no active locks remain. grok-cli quota markers are
// cleaned up. It reads the stored row (not the selection-time copy) to find
// the locks, and patches only the cleared fields, so token fields stored by an
// earlier refresh survive.
export function clearAccountError(runtime: Runtime, connection: ProviderConnection, model?: string | null): void {
  const current = runtime.repos.providers.get(connection.id);
  const data = (current?.data ?? connection.data) as Record<string, unknown>;
  const now = Date.now();
  const lockExpiry = (key: string): number => {
    const time = data[key] ? new Date(String(data[key])).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  };
  const allLockKeys = Object.keys(data).filter((key) => key.startsWith("modelLock_"));
  const grokCliFamily = grokCliQuotaFamily(model);
  const hasGrokCliQuotaMarker = hasGrokCliFamilyMarker(data, model);
  const hasBitdeerExhaustionMarker = Boolean(data[BITDEER_EXHAUSTED_MARKER]);
  const hasCodebuddyRestrictedMarker = Boolean(data[CODEBUDDY_RESTRICTED_MARKER]);
  const alimsMarkerKey = model ? alimsExhaustedMarkerKey(model) : null;
  const hasAlimsExhaustionMarker = Boolean(alimsMarkerKey && data[alimsMarkerKey] === true);
  const hasErrorState = data.testStatus === "unavailable" || Boolean(data.lastError);
  const keysToClear = allLockKeys.filter((key) => {
    if (model && key === `modelLock_${model}`) return true;
    if (model && key === "modelLock___all") return true;
    const expiry = lockExpiry(key);
    return expiry > 0 && expiry <= now;
  });
  if (keysToClear.length === 0 && !hasErrorState && !hasGrokCliQuotaMarker && !hasAlimsExhaustionMarker && !hasBitdeerExhaustionMarker && !hasCodebuddyRestrictedMarker) return;
  const remainingActive = allLockKeys.filter((key) => !keysToClear.includes(key) && lockExpiry(key) > now);
  const patch: Record<string, unknown> = {};
  for (const key of keysToClear) patch[key] = null;
  if (hasAlimsExhaustionMarker && alimsMarkerKey) patch[alimsMarkerKey] = null;
  if (hasBitdeerExhaustionMarker) patch[BITDEER_EXHAUSTED_MARKER] = null;
  if (hasCodebuddyRestrictedMarker) patch[CODEBUDDY_RESTRICTED_MARKER] = null;
  if (hasGrokCliQuotaMarker && grokCliFamily) Object.assign(patch, changedFields(data, clearGrokCliFamilyExhaustion(data, grokCliFamily)));
  if (remainingActive.length === 0) {
    patch.testStatus = "active";
    patch.lastError = null;
    patch.errorCode = null;
    patch.lastErrorAt = null;
    patch.backoffLevel = 0;
  }
  runtime.repos.providers.patch(connection.id, { data: patch });
}

// Manual cooldown reset. Drops every modelLock_* timestamp plus the error
// state, so a stale wait window stops blocking requests at once. Spends no
// reset credit. Returns false when the connection does not exist.
export function clearConnectionLocks(runtime: Runtime, connectionId: string): boolean {
  const current = runtime.repos.providers.get(connectionId);
  if (!current) return false;
  const data = current.data as Record<string, unknown>;
  const patch: Record<string, unknown> = changedFields(data, clearAllGrokCliFamilyExhaustion(data));
  for (const key of Object.keys(data)) {
    if (key.startsWith("modelLock_") || key.startsWith(ALIMS_EXHAUSTED_MARKER_PREFIX)) patch[key] = null;
  }
  if (data[CODEBUDDY_RESTRICTED_MARKER]) patch[CODEBUDDY_RESTRICTED_MARKER] = null;
  patch.testStatus = "active";
  patch.lastError = null;
  patch.errorCode = null;
  patch.lastErrorAt = null;
  patch.backoffLevel = 0;
  runtime.repos.providers.patch(connectionId, { data: patch });
  return true;
}
