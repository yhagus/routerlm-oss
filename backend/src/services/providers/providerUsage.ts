// v1 /api/usage/[connectionId] GET port: fetch per-provider quota through the
// real v1 usage adapters (open-sse/services/usage.js), with v1's credential
// refresh + auth-expired retry + grok-cli free-quota merge semantics.
import type { Runtime } from "../../runtime";
import type { ProviderConnection } from "../../db/repositories";
import { isUsageApiKeyProvider } from "./providerCatalog";
import { getV2Executor } from "../chat/executors";
import { resolveV1ProviderSpecificData } from "../chat/credentials";
import { credentialToken, refreshConnectionCredentials } from "./refreshCoordinator";
import { getAutoclawUsage } from "../billing/usageAutoclaw";
import { getUsageForProvider } from "../billing/usage.js";
import { buildGrokCliFreeQuota } from "../billing/usage/grok-cli.js";
import { GROK_CLI_FREE_USAGE_WINDOW_MS } from "./config/grokCli.ts";
import {
  grokCliFamilyQuotaName,
  grokCliFamilyQuotaRows,
  grokCliQuotaFamily,
} from "./grokCliQuotaFamily.js";

// Detect auth-expired messages returned by usage providers instead of throwing
// (v1 AUTH_EXPIRED_PATTERNS).
const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];

function isAuthExpiredMessage(usage: unknown): boolean {
  const message = (usage as { message?: unknown } | null)?.message;
  if (!message) return false;
  const text = String(message).toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((pattern) => text.includes(pattern));
}

// v2 connections keep every credential inside `data`; the v1 adapters read the
// flat v1 shape (accessToken/apiKey/providerSpecificData/projectId). Seeded v1
// rows carry a nested providerSpecificData object inside `data` — resolve it so
// executor refresh paths (e.g. qoder's PAT re-login) find their fields.
function v1ShapedConnection(connection: ProviderConnection): Record<string, any> {
  const data = (connection.credentials ?? connection.data) as Record<string, any>;
  return {
    provider: connection.provider,
    authType: connection.authType,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    apiKey: data.apiKey,
    providerSpecificData: resolveV1ProviderSpecificData(data),
    projectId: data.projectId,
  };
}

// v1 refreshAndUpdateCredentials: refresh through the registered executor and
// persist the rotated tokens through the refresh coordinator.
async function refreshAndUpdateCredentials(
  runtime: Runtime,
  connection: ProviderConnection,
  force = false,
  proxyOptions: Record<string, unknown> | null = null,
): Promise<{ connection: ProviderConnection; refreshed: boolean }> {
  const executor = getV2Executor(connection.provider) as (ReturnType<typeof getV2Executor> & { needsRefresh?(credentials: Record<string, any>): boolean }) | null;
  if (!executor?.refreshCredentials) return { connection, refreshed: false };

  const data = (connection.credentials ?? connection.data) as Record<string, any>;
  const providerSpecificData = resolveV1ProviderSpecificData(data);
  const credentials: Record<string, any> = {
    ...data,
    authType: connection.authType,
    providerSpecificData,
    connectionId: connection.id,
  };

  const needsRefresh = force || (executor.needsRefresh ? executor.needsRefresh(credentials) : false);
  if (!needsRefresh) return { connection, refreshed: false };

  // The refresh coordinator joins a refresh that a request already started for
  // this Connection and stores only the changed fields. A forced refresh passes
  // the current token as the failed token.
  const outcome = await refreshConnectionCredentials(runtime, connection.id, {
    failedAccessToken: force ? credentialToken(credentials) : undefined,
    proxyOptions: proxyOptions ?? undefined,
    log: console,
  });
  if (!outcome) {
    if (credentials.accessToken) return { connection, refreshed: false };
    throw new Error("Failed to refresh credentials. Please re-authorize the connection.");
  }
  return { connection: runtime.repos.providers.get(connection.id) ?? connection, refreshed: outcome.refreshed };
}

function getGrokCliRollingUsageByFamily(runtime: Runtime, connectionId: string, nowMs = Date.now()): Record<string, number> {
  if (!connectionId) return {};
  const cutoff = new Date(nowMs - GROK_CLI_FREE_USAGE_WINDOW_MS).toISOString();
  const now = new Date(nowMs).toISOString();
  const rows = runtime.sqlite.query(
    `SELECT model,
       COALESCE(SUM(promptTokens), 0) + COALESCE(SUM(completionTokens), 0) AS totalTokens
     FROM usageHistory
     WHERE provider = ?
       AND connectionId = ?
       AND timestamp >= ?
       AND timestamp <= ?
       AND (status IS NULL OR LOWER(status) IN ('ok', 'success', 'completed'))
     GROUP BY model`,
  ).all("grok-cli", connectionId, cutoff, now) as Array<{ model: string; totalTokens: number }>;
  const perFamily: Record<string, number> = {};
  for (const row of rows) {
    const family = grokCliQuotaFamily(row.model);
    if (!family) continue;
    perFamily[family] = (perFamily[family] || 0) + (Number(row.totalTokens) || 0);
  }
  return perFamily;
}

async function applyGrokCliFreeQuota(runtime: Runtime, connection: ProviderConnection, usage: Record<string, any>) {
  if (connection.provider !== "grok-cli") return usage;
  const data = resolveV1ProviderSpecificData((connection.credentials ?? connection.data) as Record<string, unknown>);
  const familyRows = grokCliFamilyQuotaRows(data);
  let observedByFamily: Record<string, number> = {};
  try {
    observedByFamily = getGrokCliRollingUsageByFamily(runtime, connection.id);
  } catch {
    observedByFamily = {};
  }
  const nextQuotas: Record<string, any> = { ...(usage.quotas || {}) };
  delete nextQuotas["Daily Allowance"];
  const seenFamilies = new Set<string>();
  for (const row of familyRows) {
    seenFamilies.add(row.family);
    const used = row.exhausted ? row.used : (observedByFamily[row.family] || 0);
    const limit = row.limit || 0;
    const remainingPercentage = limit > 0 ? Math.max(0, ((limit - used) / limit) * 100) : 100;
    nextQuotas[grokCliFamilyQuotaName(row.family)] = {
      used,
      total: limit,
      remainingPercentage,
      resetAt: row.resetAt,
      unlimited: false,
    };
  }
  for (const [family, observed] of Object.entries(observedByFamily)) {
    if (seenFamilies.has(family)) continue;
    const quota = buildGrokCliFreeQuota({ observedTokens: observed });
    nextQuotas[grokCliFamilyQuotaName(family)] = quota;
  }
  for (const family of ["grok-4.6", "grok-4.7"]) {
    if (seenFamilies.has(family)) continue;
    if (observedByFamily[family]) continue;
    const quota = buildGrokCliFreeQuota({ observedTokens: 0 });
    nextQuotas[grokCliFamilyQuotaName(family)] = quota;
  }
  return { ...usage, quotas: nextQuotas };
}

// Merge quota windows from QuotaTracker into the usage response for grok-cli.
function applyQuotaTrackerWindows(runtime: Runtime, connection: ProviderConnection, usage: Record<string, any>): Record<string, any> {
  if (connection.provider !== "grok-cli") return usage;
  const quotaTracker = runtime.quotaTracker;
  if (!quotaTracker) return usage;
  const snapshot = quotaTracker.getSnapshot(connection.id);
  if (!snapshot.windows.length && !snapshot.rateLimited) return usage;
  const quotaWindows: Record<string, any> = {};
  for (const window of snapshot.windows) {
    quotaWindows[window.mode] = {
      remaining: window.remaining,
      total: window.total,
      usagePercent: window.usagePercent,
      resetAt: window.resetAt,
      source: window.source,
      breakdown: window.breakdown,
    };
  }
  return {
    ...usage,
    quotaWindows,
    rateLimited: snapshot.rateLimited,
    rateLimitResetAt: snapshot.rateLimitResetAt,
  };
}

export interface UsageRouteResult {
  status: number;
  body: Record<string, unknown>;
}

export function isUsageEligibleConnection(connection: ProviderConnection): boolean {
  const isOAuth = connection.authType === "oauth";
  const isApikeyAuth = connection.authType === "apikey" || connection.authType === "api_key";
  return isOAuth || (isApikeyAuth && isUsageApiKeyProvider(connection.provider));
}

async function fetchAutoclawUsage(
  runtime: Runtime,
  connection: ProviderConnection,
  proxyOptions: Record<string, unknown> | null,
): Promise<UsageRouteResult> {
  let current = connection;
  try {
    const result = await refreshAndUpdateCredentials(runtime, current, false, proxyOptions);
    current = result.connection;
  } catch (refreshError: any) {
    return { status: 401, body: { error: `Credential refresh failed: ${(refreshError as Error).message}` } };
  }
  const data = (current.credentials ?? current.data) as Record<string, any>;
  const usage = await getAutoclawUsage(
    typeof data.accessToken === "string" ? data.accessToken : "",
    proxyOptions,
  );
  if (usage.message) return { status: 502, body: usage };
  return { status: 200, body: usage };
}

// This function owns the upstream provider request.
// The quota snapshot manager calls it outside dashboard request handling.
export async function fetchConnectionUsageFromProvider(runtime: Runtime, connectionId: string): Promise<UsageRouteResult> {
  let connection = runtime.repos.providers.get(connectionId);
  if (!connection) return { status: 404, body: { error: "Connection not found" } };

  try {
    // Allow OAuth connections, plus whitelisted apikey providers (glm/...).
    const isOAuth = connection.authType === "oauth";
    if (!isUsageEligibleConnection(connection)) {
      return { status: 200, body: { message: "Usage not available for this connection" } };
    }

    const shaped = v1ShapedConnection(connection);
    // strictProxy=false so quota/refresh fall back to direct on failure (v1).
    const proxyOptions = {
      connectionProxyEnabled: shaped.providerSpecificData.connectionProxyEnabled === true,
      connectionProxyUrl: shaped.providerSpecificData.connectionProxyUrl || "",
      connectionNoProxy: shaped.providerSpecificData.connectionNoProxy || "",
      vercelRelayUrl: shaped.providerSpecificData.vercelRelayUrl || "",
      strictProxy: false,
    };

    // Refresh credentials only for OAuth connections (apikey has no refresh).
    if (isOAuth) {
      try {
        const result = await refreshAndUpdateCredentials(runtime, connection, false, proxyOptions);
        connection = result.connection;
      } catch (refreshError: any) {
        return { status: 401, body: { error: `Credential refresh failed: ${(refreshError as Error).message}` } };
      }
    }

    // AutoClaw mints its access token from a refresh token, so it refreshes
    // through the executor and reads a points wallet instead of v1 usage.js.
    if (connection.provider === "autoclaw") {
      return await fetchAutoclawUsage(runtime, connection, proxyOptions);
    }

    let usage = (await getUsageForProvider(v1ShapedConnection(connection), proxyOptions)) as Record<string, any>;

    // If the provider returned an auth-expired message instead of throwing,
    // force-refresh the token and retry once (OAuth only).
    if (isOAuth && isAuthExpiredMessage(usage) && v1ShapedConnection(connection).refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(runtime, connection, true, proxyOptions);
        connection = retryResult.connection;
        usage = (await getUsageForProvider(v1ShapedConnection(connection), proxyOptions)) as Record<string, any>;
      } catch (retryError: any) {
        console.warn(`[Usage] ${connection.provider}: force refresh failed: ${(retryError as Error).message}`);
      }
    }

    usage = await applyGrokCliFreeQuota(runtime, connection, usage);
    usage = applyQuotaTrackerWindows(runtime, connection, usage);
    return { status: 200, body: usage };
  } catch (error: any) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Usage] ${provider}: ${(error as Error).message}`);
    return { status: 500, body: { error: (error as Error).message } };
  }
}

// Compatibility export for callers that explicitly need a direct provider request.
export const getConnectionUsage = fetchConnectionUsageFromProvider;
