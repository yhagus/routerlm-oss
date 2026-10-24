// v1 POST /api/providers/[id]/test port (src/app/api/providers/[id]/test/testUtils.js):
// per-provider OAuth probes with token refresh + retry, API-key switch, connection
// proxy resolution and pre-test, soft-success classification, and v1 persistence
// semantics (testStatus "active"/"error" + lastError/lastErrorAt + rotated tokens).
import type { Runtime } from "../../runtime";
import type { ConnectionPatch, ProviderConnection } from "../../db/repositories";
import { resolveV1ProviderSpecificData } from "../chat/credentials";
import { autoclawRefresh } from "../chat/autoclawExecutor";
import { fetchAutoclawAccount } from "./autoclawIdentity";
import { fetchExperientialLabsAccount } from "./experientialLabsIdentity";
import { PROVIDERS } from "./config/providers.ts";
import { customNodeType } from "./customNodes.ts";
import { getDefaultModel } from "./config/providerModels.ts";
import { refreshProviderCredentials, shouldRefreshCredentials } from "./oauth/oauthCredentialManager.ts";
import { proxyAwareFetch } from "../common/proxyFetch.ts";
import { deepseekHarnessPlatformHeaders } from "./deepseekHarnessPlatform.ts";
import { credentialToken, refreshAfterAuthFailure } from "./refreshCoordinator";
import { ANTIGRAVITY_CONFIG, CLAUDE_CONFIG } from "./oauth/constants/oauth.ts";

export interface ConnectionTestResult {
  valid: boolean;
  error: string | null;
  refreshed: boolean;
  latencyMs: number;
  testedAt: string;
  mergedDuplicates?: number;
}

// Backfill AutoClaw identity for rows created before the email lookup
// existed, then merge duplicates. Best-effort: identity failures never fail
// the test. Duplicates are deactivated, never deleted, so usage history
// keeps its connection linkage.
async function backfillAutoclawIdentity(runtime: Runtime, connectionId: string): Promise<number> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection || connection.provider !== "autoclaw") return 0;
  const data = (connection.data || {}) as Record<string, unknown>;
  const nested = data.providerSpecificData && typeof data.providerSpecificData === "object"
    ? data.providerSpecificData as Record<string, unknown>
    : {};
  const deviceId = typeof data.deviceId === "string" && data.deviceId
    ? data.deviceId
    : typeof nested.deviceId === "string" ? nested.deviceId : "";
  if (!deviceId) return 0;
  // Use the stored access token. Refresh only when the profile rejects it,
  // and only through the refresh coordinator, which stores the rotated
  // refresh token.
  const storedToken = typeof data.accessToken === "string" && data.accessToken ? data.accessToken : null;
  let account: Awaited<ReturnType<typeof fetchAutoclawAccount>> = null;
  try {
    if (storedToken) account = await fetchAutoclawAccount(storedToken, deviceId);
    if (!account) {
      const refreshed = await refreshAfterAuthFailure(runtime, connectionId, storedToken);
      if (refreshed?.accessToken) account = await fetchAutoclawAccount(refreshed.accessToken, deviceId);
    }
  } catch {
    return 0;
  }
  if (!account) return 0;

  const patch: ConnectionPatch = { data: {} };
  if (!connection.email) patch.email = account.email;
  if (!connection.name) patch.name = account.email;
  if (!data.autoclawUserId && account.userId) patch.data!.autoclawUserId = account.userId;
  const identity = runtime.repos.providers.patch(connectionId, patch) ?? connection;

  const emailKey = account.email.toLowerCase();
  const userKey = account.userId || null;
  const emailOf = (row: typeof connection): string | null =>
    typeof row.email === "string" && row.email ? row.email.toLowerCase() : null;
  const userOf = (row: typeof connection): string | null => {
    const value = (row.data as Record<string, unknown> | undefined)?.autoclawUserId;
    return typeof value === "string" && value ? value : null;
  };
  let merged = 0;
  for (const row of runtime.repos.providers.list(true)) {
    if (row.provider !== "autoclaw" || row.id === identity.id || row.isActive === false) continue;
    const sameEmail = emailOf(row) === emailKey;
    const sameUser = userKey !== null && userOf(row) === userKey;
    if (sameEmail || sameUser) {
      runtime.repos.providers.patch(row.id, { isActive: false });
      merged += 1;
    }
  }
  return merged;
}

// Rename Experiential Labs rows to their org_slug and merge duplicate orgs.
// Rows still carrying an auto-generated "Key N" name get renamed on test;
// explicitly named rows keep their name. Best-effort, never fails the test.
async function backfillExperientialLabsIdentity(runtime: Runtime, connectionId: string): Promise<number> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection || connection.provider !== "experiential-labs") return 0;
  const data = (connection.data || {}) as Record<string, unknown>;
  const nested = data.providerSpecificData && typeof data.providerSpecificData === "object"
    ? data.providerSpecificData as Record<string, unknown>
    : {};
  const apiKey = typeof data.apiKey === "string" && data.apiKey
    ? data.apiKey
    : typeof nested.apiKey === "string" ? nested.apiKey : "";
  if (!apiKey) return 0;
  let account: Awaited<ReturnType<typeof fetchExperientialLabsAccount>> = null;
  try {
    account = await fetchExperientialLabsAccount(apiKey);
  } catch {
    return 0;
  }
  if (!account) return 0;

  const patch: ConnectionPatch = { data: {} };
  if (!connection.name || /^key \d+$/i.test(connection.name)) patch.name = account.orgSlug;
  if (!data.experientialLabsOrgSlug) patch.data!.experientialLabsOrgSlug = account.orgSlug;
  if (!data.experientialLabsOrgId && account.orgId) patch.data!.experientialLabsOrgId = account.orgId;
  if (!data.experientialLabsOrgName && account.orgName) patch.data!.experientialLabsOrgName = account.orgName;
  const identity = runtime.repos.providers.patch(connectionId, patch) ?? connection;

  const slugOf = (row: typeof connection): string | null => {
    const value = (row.data as Record<string, unknown> | undefined)?.experientialLabsOrgSlug;
    return typeof value === "string" && value ? value.toLowerCase() : null;
  };
  let merged = 0;
  for (const row of runtime.repos.providers.list(true)) {
    if (row.provider !== "experiential-labs" || row.id === identity.id || row.isActive === false) continue;
    if (slugOf(row) === account.orgSlug) {
      runtime.repos.providers.patch(row.id, { isActive: false });
      merged += 1;
    }
  }
  return merged;
}

// v1 OAUTH_TEST_CONFIG — provider-specific probe endpoints and refresh semantics.
const OAUTH_TEST_CONFIG: Record<string, Record<string, any>> = {
  claude: { checkExpiry: true, refreshable: true },
  codex: {
    url: "https://chatgpt.com/backend-api/codex/responses",
    method: "POST",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "Content-Type": "application/json", "originator": "codex_cli_rs", "User-Agent": "codex_cli_rs/0.136.0" },
    // Minimal invalid body — triggers fast 400 without consuming quota
    body: JSON.stringify({ model: "gpt-5.3-codex", input: [] as any[], stream: false, store: false }),
    // 400 (bad request) means auth succeeded; only 401/403 means token is bad
    acceptStatuses: [400],
    refreshable: true,
  },
  antigravity: {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  qoder: {
    // Test by hitting Qoder's userinfo endpoint with the device token.
    // refreshable: false because the device-flow refresh endpoint returns
    // 403 for our flow (users re-login when expired). No checkExpiry —
    // we want the actual URL probe to run so revoked tokens surface.
    url: "https://openapi.qoder.sh/api/v1/userinfo",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: false,
  },
  "codebuddy-intl-cli": { tokenExists: true },
  // DeepSeek Harness account — probe the Platform current-user endpoint with
  // the account token (x-dsh-auth-token). No refresh token exists: a rejected
  // token means the user must sign in again.
  "deepseek-harness": {
    // The summary endpoint is an official authenticated account endpoint and
    // is also used by the quota reader. The profile endpoint is blocked by
    // some upstream gateways even when the same token is accepted here.
    url: "https://platform.deepseek.com/api/v0/users/get_user_summary",
    method: "GET",
    authHeader: "x-dsh-auth-token",
    authPrefix: "",
    refreshable: false,
  },
  // Grok CLI / Grok Build — probe /v1/user (no inference quota). Headers mirror official CLI.
  "grok-cli": {
    url: PROVIDERS["grok-cli"]?.userUrl || "https://cli-chat-proxy.grok.com/v1/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: {
      Accept: "application/json",
      ...(PROVIDERS["grok-cli"]?.headers || {
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
        "x-xai-token-auth": "xai-grok-cli",
        "x-grok-client-identifier": "grok-pager",
        "x-grok-client-version": "0.2.93",
      }),
    },
    refreshable: true,
    // Subscription spending-limit is not an auth failure — token is fine, credits aren't.
    // Accept 402 so the connection stays "active" with a warning (same idea as Codex 400).
    acceptStatuses: [402],
    softFailMessage: {
      402: "Connected, but Grok Build credits are exhausted (spending limit). Add credits or upgrade SuperGrok.",
    },
  },
};

// v2 connections keep credentials in the `data` bag; the v1 probe/refresh helpers
// read the flat v1 shape. Seeded v1 rows carry a nested providerSpecificData.
function v1Shape(connection: ProviderConnection): Record<string, any> {
  const data = { ...((connection.data || {}) as Record<string, any>) };
  return {
    id: connection.id,
    provider: connection.provider,
    authType: connection.authType,
    name: connection.name,
    email: connection.email,
    ...data,
    providerSpecificData: resolveV1ProviderSpecificData(data),
  };
}

// v1 fetchWithConnectionProxy: relay proxies forward via vercelRelayUrl, standard
// pools via proxyAwareFetch connection flags, otherwise plain fetch.
async function fetchWithConnectionProxy(url: string, options: Record<string, any> = {}, effectiveProxy: Record<string, any> | null = null): Promise<Response> {
  if (effectiveProxy?.vercelRelayUrl) {
    return proxyAwareFetch(url, options, { vercelRelayUrl: effectiveProxy.vercelRelayUrl });
  }
  if (!effectiveProxy?.connectionProxyEnabled || !effectiveProxy?.connectionProxyUrl) {
    return fetch(url, options);
  }
  return proxyAwareFetch(url, options, {
    connectionProxyEnabled: true,
    connectionProxyUrl: effectiveProxy.connectionProxyUrl,
    connectionNoProxy: effectiveProxy.connectionNoProxy || "",
  });
}

// v1 resolveConnectionProxyConfig (src/lib/network/connectionProxy.js): proxy pool
// first (relay types map to vercelRelayUrl), then legacy per-connection proxy.
async function resolveConnectionProxyConfig(runtime: Runtime, providerSpecificData: Record<string, any> = {}): Promise<Record<string, any>> {
  const normalize = (value: unknown) => String(value ?? "").trim();
  const proxyPoolIdRaw = normalize(providerSpecificData?.proxyPoolId);
  const proxyPoolId = proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;
  const legacy = {
    connectionProxyEnabled: providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: normalize(providerSpecificData?.connectionProxyUrl),
    connectionNoProxy: normalize(providerSpecificData?.connectionNoProxy),
    strictProxy: providerSpecificData?.strictProxy === true,
  };

  if (proxyPoolId) {
    const pool = runtime.repos.proxies.get(proxyPoolId) as (Record<string, any> | null);
    const proxyUrl = normalize(pool?.proxyUrl);
    const noProxy = normalize(pool?.noProxy);
    const isValidPool = pool && (pool as { isActive?: boolean }).isActive === true && proxyUrl;
    if (isValidPool) {
      if (pool.type === "vercel" || pool.type === "cloudflare" || pool.type === "deno") {
        return {
          source: pool.type,
          proxyPoolId,
          proxyPool: pool,
          connectionProxyEnabled: false,
          connectionProxyUrl: "",
          connectionNoProxy: noProxy,
          strictProxy: pool.strictProxy === true,
          vercelRelayUrl: proxyUrl,
        };
      }
      return {
        source: "pool",
        proxyPoolId,
        proxyPool: pool,
        connectionProxyEnabled: true,
        connectionProxyUrl: proxyUrl,
        connectionNoProxy: noProxy,
        strictProxy: pool.strictProxy === true,
      };
    }
  }

  if (legacy.connectionProxyEnabled && legacy.connectionProxyUrl) return { source: "legacy", ...legacy };
  return { source: "none", connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "", strictProxy: false };
}

// v1 testProxyUrl (src/lib/network/proxyTest.js): HEAD through the proxy with an
// 8s budget. Bun's fetch routes through proxyAwareFetch instead of undici.
async function testProxyUrl(proxyUrl: string): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await proxyAwareFetch("https://google.com/", {
      method: "HEAD",
      headers: { "User-Agent": "LobakAI" },
      signal: AbortSignal.timeout(8000),
    }, { connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, connectionNoProxy: "" });
    if (res.ok) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `Proxy test failed with status ${res.status}` };
  } catch (error: any) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

// v1 classifyOAuthProbeResult: success / soft-success (Grok CLI 402) / hard-fail.
function classifyOAuthProbeResult(res: Response | null, config: Record<string, any>, _bodyText = ""): { valid: boolean; error: string | null; soft: boolean } {
  if (!res) return { valid: false, error: "No response", soft: false };
  const status = res.status;
  const accepted = res.ok || (config?.acceptStatuses && config.acceptStatuses.includes(status));
  if (!accepted) {
    if (status === 401) return { valid: false, error: "Token invalid or revoked", soft: false };
    if (status === 403) return { valid: false, error: "Access denied", soft: false };
    return { valid: false, error: `API returned ${status}`, soft: false };
  }
  if (!res.ok && config?.acceptStatuses?.includes(status)) {
    const softMap = config.softFailMessage || {};
    if (softMap[status]) return { valid: true, error: softMap[status], soft: true };
    return { valid: true, error: null, soft: false };
  }
  return { valid: true, error: null, soft: false };
}


const CLOUD_CODE_ASSIST_TEST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const CLOUD_CODE_ASSIST_TEST_BODY = JSON.stringify({
  metadata: { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
});

function parseProviderErrorMessage(bodyText: string, fallback: string): string {
  if (!bodyText) return fallback;
  try {
    const parsed = JSON.parse(bodyText);
    const message = parsed?.error?.message || parsed?.message || parsed?.error;
    if (typeof message === "string" && message.trim()) return message.trim();
    if (message) return JSON.stringify(message);
  } catch { /* fall through */ }
  return bodyText.trim() || fallback;
}

async function probeCloudCodeAssistAccess(connection: Record<string, any>, accessToken: string, effectiveProxy: Record<string, any> | null = null): Promise<{ valid: boolean; error: string | null; status?: number }> {
  const userAgent = "google-api-nodejs-client/9.15.1 vscode-antigravity/1.107.0";
  const res = await fetchWithConnectionProxy(CLOUD_CODE_ASSIST_TEST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    body: CLOUD_CODE_ASSIST_TEST_BODY,
  }, effectiveProxy);
  if (res.ok) return { valid: true, error: null };
  const bodyText = await res.text().catch(() => "");
  return { valid: false, error: parseProviderErrorMessage(bodyText, `API returned ${res.status}`), status: res.status };
}

// v1 refreshOAuthToken: provider-specific refresh, executor-backed for codex/grok-cli.
async function refreshOAuthToken(connection: Record<string, any>): Promise<Record<string, any> | null> {
  const provider = connection.provider;
  const refreshToken = connection.refreshToken;
  if (!refreshToken) return null;

  try {
    if (provider === "antigravity") {
      const config = ANTIGRAVITY_CONFIG;
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "codex" || provider === "grok-cli") {
      return await refreshProviderCredentials(provider, connection, console);
    }

    if (provider === "claude") {
      const response = await fetch(CLAUDE_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: CLAUDE_CONFIG.clientId }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }




    return null;
  } catch (err: any) {
    console.log(`Error refreshing ${provider} token:`, (err as Error).message);
    return null;
  }
}

function isTokenExpired(connection: Record<string, any>): boolean {
  return shouldRefreshCredentials(connection.provider, connection);
}


// Refreshes the tested Connection. `failedAccessToken` is the token that the
// probe used. A stored Connection passes the refresh coordinator here.
type TestRefresh = (connection: Record<string, any>, failedAccessToken: string | null) => Promise<Record<string, any> | null>;

async function testOAuthConnection(connection: Record<string, any>, effectiveProxy: Record<string, any> | null = null, refresh: TestRefresh = (current) => refreshOAuthToken(current)): Promise<Record<string, any>> {
  const config = OAUTH_TEST_CONFIG[connection.provider];
  if (!config) return { valid: false, error: "Provider test not supported", refreshed: false };
  if (!connection.accessToken) return { valid: false, error: "No access token", refreshed: false };

  // Token-only providers: verify the token exists, not an endpoint
  if (config.tokenExists) return { valid: true, error: null, refreshed: false, newTokens: null };

  let accessToken = connection.accessToken;
  let refreshed = false;
  let newTokens: Record<string, any> | null = null;

  const tokenExpired = isTokenExpired(connection);
  if (config.refreshable && tokenExpired && connection.refreshToken) {
    const tokens = await refresh(connection, accessToken);
    if (tokens) {
      accessToken = tokens.accessToken;
      refreshed = true;
      newTokens = tokens;
    } else {
      return { valid: false, error: "Token expired and refresh failed", refreshed: false };
    }
  }

  if (config.checkExpiry) {
    if (refreshed) return { valid: true, error: null, refreshed, newTokens };
    if (tokenExpired) return { valid: false, error: "Token expired", refreshed: false };
    return { valid: true, error: null, refreshed: false, newTokens: null };
  }

  if (connection.provider === "antigravity") {
    const initial = await probeCloudCodeAssistAccess(connection, accessToken, effectiveProxy);
    if (initial.valid) return { valid: true, error: null, refreshed, newTokens };
    if (initial.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refresh(connection, accessToken);
      if (tokens?.accessToken) {
        const retry = await probeCloudCodeAssistAccess(connection, tokens.accessToken, effectiveProxy);
        if (retry.valid) return { valid: true, error: null, refreshed: true, newTokens: tokens };
        return { valid: false, error: retry.error, refreshed: true, newTokens: tokens };
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }
    return { valid: false, error: initial.error, refreshed };
  }


  try {
    const testUrl = config.buildUrl ? config.buildUrl(accessToken) : config.url;
    const headers = config.noAuth
      ? { ...config.extraHeaders }
      : {
          [config.authHeader]: `${config.authPrefix}${accessToken}`,
          ...config.extraHeaders,
          ...(connection.provider === "deepseek-harness" ? { Accept: "application/json", ...deepseekHarnessPlatformHeaders() } : {}),
        };
    const fetchOpts: Record<string, any> = {
      method: config.method,
      headers,
      ...(connection.provider === "deepseek-harness" ? { redirect: "error" } : {}),
    };
    if (config.body) fetchOpts.body = config.body;
    const res = await fetchWithConnectionProxy(testUrl, fetchOpts, effectiveProxy);

    const classified = classifyOAuthProbeResult(res, config);
    if (!classified.valid && res.status === 403 && connection.provider === "deepseek-harness") {
      const contentType = res.headers.get("content-type") || "";
      const detail = (await res.clone().text().catch(() => "")).trim().replace(/\s+/g, " ").slice(0, 180);
      if (contentType.includes("text/html") || /^<!doctype html|^<html/i.test(detail)) {
        classified.error = "DeepSeek Platform access was blocked by an HTTP proxy or network ACL";
      } else if (detail) {
        classified.error = `Access denied: ${detail}`;
      }
    }
    if (classified.valid) {
      return {
        valid: true,
        error: classified.soft ? classified.error : null,
        warning: classified.soft ? classified.error : null,
        refreshed,
        newTokens,
      };
    }

    if (res.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refresh(connection, accessToken);
      if (tokens) {
        const retryUrl = config.buildUrl ? config.buildUrl(tokens.accessToken) : testUrl;
        const retryHeaders = config.noAuth
          ? { ...config.extraHeaders }
          : { [config.authHeader]: `${config.authPrefix}${tokens.accessToken}`, ...config.extraHeaders };
        const retryOpts: Record<string, any> = { method: config.method, headers: retryHeaders };
        if (config.body) retryOpts.body = config.body;
        const retryRes = await fetchWithConnectionProxy(retryUrl, retryOpts, effectiveProxy);
        const retryClassified = classifyOAuthProbeResult(retryRes, config);
        if (retryClassified.valid) {
          return {
            valid: true,
            error: retryClassified.soft ? retryClassified.error : null,
            warning: retryClassified.soft ? retryClassified.error : null,
            refreshed: true,
            newTokens: tokens,
          };
        }
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    return { valid: false, error: classified.error, refreshed };
  } catch (err: any) {
    return { valid: false, error: (err as Error).message, refreshed };
  }
}

// v1-compatible provider detection: compatible nodes are backed by providerNodes rows.
function compatibleKind(provider: string): "openai" | "anthropic" | null {
  const type = customNodeType(provider);
  if (type === "anthropic-compatible") return "anthropic";
  if (type === "openai-compatible" || type === "custom-embedding") return "openai";
  return null;
}

async function testApiKeyConnection(connection: Record<string, any>, effectiveProxy: Record<string, any> | null = null, refreshStored: (() => Promise<Record<string, any> | null>) | null = null): Promise<{ valid: boolean; error: string | null; refreshed?: boolean }> {
  const kind = compatibleKind(connection.provider);
  if (kind === "openai") {
    const modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) return { valid: false, error: "Missing base URL" };
    try {
      const res = await fetchWithConnectionProxy(`${modelsBase.replace(/\/$/, "")}/models`, {
        headers: { Authorization: `Bearer ${connection.apiKey}` },
      }, effectiveProxy);
      return { valid: res.ok, error: res.ok ? null : "Invalid API key or base URL" };
    } catch (err: any) {
      return { valid: false, error: (err as Error).message };
    }
  }

  if (kind === "anthropic") {
    let modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) return { valid: false, error: "Missing base URL" };
    try {
      modelsBase = modelsBase.replace(/\/$/, "");
      if (modelsBase.endsWith("/messages")) modelsBase = modelsBase.slice(0, -9);
      const messagesUrl = `${modelsBase}/v1/messages`;
      const model = connection.defaultModel || "claude-3-haiku-20240307";
      const res = await fetchWithConnectionProxy(messagesUrl, {
        method: "POST",
        headers: {
          "x-api-key": connection.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          Authorization: `Bearer ${connection.apiKey}`,
        },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
      }, effectiveProxy);
      // 400/529 still confirms key accepted; only 401/403 = bad key
      const valid = res.status !== 401 && res.status !== 403;
      return { valid, error: valid ? null : "Invalid API key or base URL" };
    } catch (err: any) {
      return { valid: false, error: (err as Error).message };
    }
  }

  try {
    switch (connection.provider) {
      case "openai": {
        const res = await fetchWithConnectionProxy("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "zenmux": {
        const res = await fetchWithConnectionProxy("https://zenmux.ai/api/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "bitdeer": {
        const res = await fetchWithConnectionProxy("https://api-inference.bitdeer.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "experiential-labs": {
        const account = await fetchExperientialLabsAccount(connection.apiKey || "");
        return account
          ? { valid: true, error: null }
          : { valid: false, error: "Invalid API key" };
      }
      case "autoclaw": {
        // The refresh token is the credential under test: one refresh proves it.
        const refreshed = refreshStored ? await refreshStored() : null;
        return refreshed
          ? { valid: true, error: null, refreshed: true }
          : { valid: false, error: "Invalid or expired refresh token" };
      }
      case "anthropic": {
        const res = await fetchWithConnectionProxy("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "glm": {
        const res = await fetchWithConnectionProxy("https://api.z.ai/api/anthropic/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "glm-4.7", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "glm-cn": {
        const res = await fetchWithConnectionProxy("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${connection.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "glm-4.7", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "alims-intl": {
        // alims-intl uses the Model Studio compatible-mode API
        const res = await fetchWithConnectionProxy("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${connection.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: getDefaultModel(connection.provider), max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "deepseek": {
        const res = await fetchWithConnectionProxy("https://api.deepseek.com/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "inferhub": {
        const res = await fetchWithConnectionProxy("https://api.inferhub.dev/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "mistral": {
        const res = await fetchWithConnectionProxy("https://api.mistral.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "hyperbolic": {
        const res = await fetchWithConnectionProxy("https://api.hyperbolic.xyz/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "deepgram": {
        const res = await fetchWithConnectionProxy("https://api.deepgram.com/v1/projects", { headers: { Authorization: `Token ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "assemblyai": {
        const res = await fetchWithConnectionProxy("https://api.assemblyai.com/v1/account", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "nanobanana": {
        const res = await fetchWithConnectionProxy("https://api.nanobananaapi.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "fal-ai": {
        const res = await fetchWithConnectionProxy("https://api.fal.ai/v1/models?limit=1", { headers: { Authorization: `Key ${connection.apiKey}` } }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "grok-web": {
        const token = connection.apiKey.startsWith("sso=") ? connection.apiKey.slice(4) : connection.apiKey;
        const randomHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
        const statsigId = Buffer.from("e:TypeError: Cannot read properties of null (reading 'children')").toString("base64");
        const res = await fetchWithConnectionProxy("https://grok.com/rest/app-chat/conversations/new", {
          method: "POST",
          headers: {
            Accept: "*/*", "Content-Type": "application/json",
            Cookie: `sso=${token}`, Origin: "https://grok.com", Referer: "https://grok.com/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            "x-statsig-id": statsigId, "x-xai-request-id": crypto.randomUUID(),
            traceparent: `00-${randomHex(16)}-${randomHex(8)}-00`,
          },
          body: JSON.stringify({ temporary: true, modelName: "grok-4", message: "ping", fileAttachments: [] as any[], imageAttachments: [] as any[], disableSearch: false, enableImageGeneration: false, sendFinalMetadata: true }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid SSO cookie" };
      }
      case "perplexity-web": {
        let sessionToken = connection.apiKey;
        if (sessionToken.startsWith("__Secure-next-auth.session-token=")) sessionToken = sessionToken.slice("__Secure-next-auth.session-token=".length);
        const res = await fetchWithConnectionProxy("https://www.perplexity.ai/api/auth/session", {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            Cookie: `__Secure-next-auth.session-token=${sessionToken}`,
          },
        }, effectiveProxy);
        if (!res.ok) return { valid: false, error: "Invalid session cookie" };
        const data = await res.json().catch(() => null);
        const valid = !!(data && (data as Record<string, any>).user);
        return { valid, error: valid ? null : "Session expired — re-paste cookie" };
      }
      // OpenCode accounts hold an optional API key for paid models.
      case "opencode":
      case "opencode-go": {
        const res = await fetchWithConnectionProxy("https://opencode.ai/inference/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.apiKey}` },
          body: JSON.stringify({ model: getDefaultModel("opencode-go"), messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "qoder": {
        // PAT (pt-...) exchange → job token. A successful exchange proves the PAT.
        const raw = connection.apiKey || "";
        const pat = raw.startsWith("pt-") ? raw : `pt-${raw}`;
        const exRes = await fetchWithConnectionProxy(
          "https://openapi.qoder.sh/api/v1/jobToken/exchange",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "Cosy-Version": "1.0.1",
              "Cosy-ClientType": "5",
            },
            body: JSON.stringify({ personal_token: pat }),
          },
          effectiveProxy,
        );
        return { valid: exRes.ok, error: exRes.ok ? null : "Invalid Personal Access Token" };
      }
      default:
        return await probeRegistryOpenAICompatible(connection, effectiveProxy);
    }
  } catch (err: any) {
    return { valid: false, error: (err as Error).message };
  }
}

// v1 probeRegistryOpenAICompatible: generic OpenAI-compatible registry providers
// via transport.validateUrl or baseUrl-derived /models.
async function probeRegistryOpenAICompatible(connection: Record<string, any>, effectiveProxy: Record<string, any> | null = null): Promise<{ valid: boolean; error: string | null }> {
  const cfg = PROVIDERS[connection.provider];
  if (!cfg || (cfg.format && cfg.format !== "openai") || (!cfg.validateUrl && !cfg.baseUrl)) {
    return { valid: false, error: "Provider test not supported" };
  }
  if (!connection.apiKey && !cfg.noAuth) {
    return { valid: false, error: "No API key" };
  }

  const modelsUrl = cfg.validateUrl
    || cfg.baseUrl
      .replace(/\/chat\/completions$/, "/models")
      .replace(/\/chatbot$/, "/models");

  const headers: Record<string, string> = { ...(cfg.headers || {}) };
  if (cfg.authHeader === "x-api-key") headers["X-API-Key"] = connection.apiKey;
  else if (connection.apiKey) headers.Authorization = `Bearer ${connection.apiKey}`;

  try {
    const res = await fetchWithConnectionProxy(modelsUrl, { headers }, effectiveProxy);
    return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
  } catch (err: any) {
    return { valid: false, error: (err as Error).message };
  }
}

// v1 testSingleConnection: probe, persist status/tokens, return the row test result.
export async function testSingleConnection(runtime: Runtime, id: string): Promise<ConnectionTestResult> {
  const connection = runtime.repos.providers.get(id);
  if (!connection) return { valid: false, error: "Connection not found", refreshed: false, latencyMs: 0, testedAt: new Date().toISOString() };

  const shaped = v1Shape(connection);
  const effectiveProxy = await resolveConnectionProxyConfig(runtime, shaped.providerSpecificData || {});

  if (effectiveProxy.connectionProxyEnabled && effectiveProxy.connectionProxyUrl && !effectiveProxy.vercelRelayUrl) {
    const proxyResult = await testProxyUrl(effectiveProxy.connectionProxyUrl);
    if (!proxyResult.ok) {
      const proxyError = proxyResult.error || `Proxy test failed with status ${proxyResult.status}`;
      persistTestResult(runtime, connection, { valid: false, error: proxyError });
      return { valid: false, error: proxyError, refreshed: false, latencyMs: 0, testedAt: new Date().toISOString() };
    }
  }

  const start = Date.now();
  let result: Record<string, any>;
  if (connection.authType === "apikey" || connection.authType === "cookie") {
    // The probe refreshes through the refresh coordinator, which stores the
    // new tokens and joins a refresh that a request already started.
    result = await testApiKeyConnection(shaped, effectiveProxy, () => refreshAfterAuthFailure(runtime, connection.id, credentialToken(shaped)));
  } else {
    result = await testOAuthConnection(shaped, effectiveProxy, (_shaped, failedAccessToken) => refreshAfterAuthFailure(runtime, connection.id, failedAccessToken, {
      refresh: (_credentials, current) => refreshOAuthToken(v1Shape(current)),
    }));
  }
  const latencyMs = Date.now() - start;

  persistTestResult(runtime, connection, result);
  let mergedDuplicates = 0;
  if (result.valid && connection.provider === "autoclaw") {
    try {
      mergedDuplicates = await backfillAutoclawIdentity(runtime, connection.id);
    } catch { /* identity backfill never fails the test */ }
  }
  if (result.valid && connection.provider === "experiential-labs") {
    try {
      mergedDuplicates = await backfillExperientialLabsIdentity(runtime, connection.id);
    } catch { /* identity backfill never fails the test */ }
  }
  return { valid: !!result.valid, error: result.error ?? null, refreshed: !!result.refreshed, latencyMs, testedAt: new Date().toISOString(), mergedDuplicates };
}

// v1 updateProviderConnection updateData: testStatus "active"/"error", with a
// soft-success warning kept in lastError. Refreshed tokens are not written
// here: the refresh coordinator stored them before the probe, and a newer
// refresh may have replaced them while the probe waited.
function persistTestResult(runtime: Runtime, connection: ProviderConnection, result: Record<string, any>) {
  const softWarning = result.valid && (result.warning || result.error);
  runtime.repos.providers.patch(connection.id, {
    data: {
      testStatus: result.valid ? "active" : "error",
      lastError: result.valid ? (softWarning || null) : result.error,
      lastErrorAt: result.valid ? (softWarning ? new Date().toISOString() : null) : new Date().toISOString(),
    },
  });
}

// ─── v1 POST /api/providers/validate port (AddApiKeyModal "Check" button) ───
import { AI_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "../platform/shared/constants/providers.ts";
import { normalizeProviderId } from "../platform/providerNormalization.ts";
import { openaiToCommandCodeRequest } from "../chat/translator/request/openai-to-commandcode.js";

type ValidateOutcome = { status: number; payload: Record<string, unknown> };

// v1 nodes repo returns flat objects; v2 keeps baseUrl in the data JSON.
function nodeOf(runtime: Runtime, id: string): Record<string, any> | null {
  const row = runtime.repos.nodes.get(id) as Record<string, any> | null;
  if (!row) return null;
  let data: Record<string, any> = {};
  try { data = typeof row.data === "string" ? JSON.parse(row.data) : (row.data || {}); } catch { data = {}; }
  return { ...row, ...data };
}

// Probe a webSearch/webFetch provider using its searchConfig/fetchConfig (v1).
async function probeWebProvider(provider: string, apiKey: string): Promise<boolean | null> {
  const p = AI_PROVIDERS[provider];
  if (!p) return null;
  const kinds = p.serviceKinds || ["llm"];
  const isWebOnly = kinds.every((k: string) => k === "webSearch" || k === "webFetch");
  if (!isWebOnly) return null;
  const cfg = p.searchConfig || p.fetchConfig;
  if (!cfg) return null;
  if (cfg.authType === "none") return true;

  let url: string = cfg.baseUrl;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: string | undefined;

  switch (cfg.authHeader) {
    case "bearer": headers.Authorization = `Bearer ${apiKey}`; break;
    case "x-api-key": headers["x-api-key"] = apiKey; break;
    case "x-subscription-token": headers["x-subscription-token"] = apiKey; break;
    case "key": url += `?key=${encodeURIComponent(apiKey)}&q=ping&cx=test`; break; // google-pse
    case "api_key": url += `?api_key=${encodeURIComponent(apiKey)}&q=ping&engine=google`; break; // searchapi
  }

  if (cfg.method === "POST") body = JSON.stringify({ query: "ping", q: "ping", url: "https://example.com" });

  const res = await fetch(url, { method: cfg.method, headers, body, signal: AbortSignal.timeout(8000) });
  return res.status !== 401 && res.status !== 403;
}

// Probe a media provider (tts/embedding/stt/image/video) using *Config (v1).
async function probeMediaProvider(provider: string, apiKey: string): Promise<boolean | null> {
  const p = AI_PROVIDERS[provider];
  if (!p) return null;
  const MEDIA_KINDS = new Set(["tts", "embedding", "stt", "image", "video", "music", "imageToText"]);
  const kinds = p.serviceKinds || ["llm"];
  const isMediaOnly = kinds.every((k: string) => MEDIA_KINDS.has(k));
  if (!isMediaOnly) return null;
  const cfg = p.ttsConfig || p.sttConfig || p.embeddingConfig || p.imageConfig || p.videoConfig || p.musicConfig;
  if (!cfg) return true;
  if (p.noAuth || cfg.authType === "none") return true;
  if (cfg.authHeader === "playht" || cfg.authHeader === "aws-sigv4") return true;

  const headers: Record<string, string> = { "Content-Type": "application/json", ...(cfg.extraHeaders || {}) };
  switch (cfg.authHeader) {
    case "bearer": headers.Authorization = `Bearer ${apiKey}`; break;
    case "key": headers.Authorization = `Key ${apiKey}`; break;
    case "x-api-key": headers["x-api-key"] = apiKey; break;
    case "x-key": headers["x-key"] = apiKey; break;
    case "xi-api-key": headers["xi-api-key"] = apiKey; break;
    case "token": headers.Authorization = `Token ${apiKey}`; break;
    case "basic": headers.Authorization = `Basic ${apiKey}`; break;
    default: return null;
  }

  const method = cfg.method || "POST";
  const res = await fetch(cfg.baseUrl, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify({ input: "ping", text: "ping", prompt: "ping", model: getDefaultModel(provider) || "test" }),
    signal: AbortSignal.timeout(8000),
  });
  return res.status !== 401 && res.status !== 403;
}

// v1 POST /api/providers/validate: per-provider API-key validation used by the
// Add Connection modal's Check button.
export async function validateProviderApiKey(runtime: Runtime, body: Record<string, any>): Promise<ValidateOutcome> {
  const provider = normalizeProviderId(body.provider);
  const { apiKey } = body;
  const providerSpecificData = body.providerSpecificData || {};

  const isNoAuth = AI_PROVIDERS[provider]?.noAuth === true;
  if (!provider || (!apiKey && !isNoAuth)) {
    return { status: 400, payload: { error: "Provider and API key required" } };
  }

  let isValid = false;
  let error: string | null = null;

  try {
    if (isOpenAICompatibleProvider(provider)) {
      const node = nodeOf(runtime, provider);
      if (!node) return { status: 404, payload: { error: "OpenAI Compatible node not found" } };
      const modelsUrl = `${node.baseUrl?.replace(/\/$/, "")}/models`;
      const res = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
      return { status: 200, payload: { valid: res.ok, error: res.ok ? null : "Invalid API key" } };
    }


    if (isCustomEmbeddingProvider(provider)) {
      const node = nodeOf(runtime, provider);
      if (!node) return { status: 404, payload: { error: "Custom Embedding node not found" } };
      const baseUrl = node.baseUrl?.replace(/\/$/, "");
      const modelsRes = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (modelsRes.ok) return { status: 200, payload: { valid: true } };
      if (modelsRes.status === 401 || modelsRes.status === 403) {
        return { status: 200, payload: { valid: false, error: "Invalid API key" } };
      }
      const embedRes = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "test", input: "ping" }),
      });
      isValid = embedRes.status !== 401 && embedRes.status !== 403;
      return { status: 200, payload: { valid: isValid, error: isValid ? null : "Invalid API key" } };
    }

    if (isAnthropicCompatibleProvider(provider)) {
      const node = nodeOf(runtime, provider);
      if (!node) return { status: 404, payload: { error: "Anthropic Compatible node not found" } };
      let normalizedBase = node.baseUrl?.trim().replace(/\/$/, "") || "";
      if (normalizedBase.endsWith("/messages")) normalizedBase = normalizedBase.slice(0, -9);
      const messagesUrl = `${normalizedBase}/v1/messages`;
      const model = node.defaultModel || "claude-3-haiku-20240307";
      const res = await fetch(messagesUrl, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
      });
      isValid = res.status !== 401 && res.status !== 403;
      return { status: 200, payload: { valid: isValid, error: isValid ? null : "Invalid API key" } };
    }



    const webResult = await probeWebProvider(provider, apiKey);
    if (webResult !== null) return { status: 200, payload: { valid: webResult, error: webResult ? null : "Invalid API key" } };

    const mediaResult = await probeMediaProvider(provider, apiKey);
    if (mediaResult !== null) return { status: 200, payload: { valid: mediaResult, error: mediaResult ? null : "Invalid API key" } };

    switch (provider) {
      case "openai": {
        const openaiRes = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
        isValid = openaiRes.ok;
        break;
      }
      case "zenmux": {
        const zenmuxRes = await fetch("https://zenmux.ai/api/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
        isValid = zenmuxRes.ok;
        break;
      }
      case "bitdeer": {
        const bitdeerRes = await fetch("https://api-inference.bitdeer.ai/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
        isValid = bitdeerRes.ok;
        break;
      }
      case "experiential-labs": {
        isValid = Boolean(await fetchExperientialLabsAccount(apiKey));
        if (!isValid) error = "Invalid API key";
        break;
      }
      case "autoclaw": {
        const deviceId = typeof providerSpecificData?.deviceId === "string" ? providerSpecificData.deviceId : undefined;
        const refreshed = await autoclawRefresh(apiKey, deviceId);
        isValid = Boolean(refreshed);
        if (!isValid) error = "Invalid or expired refresh token";
        break;
      }
      case "anthropic": {
        const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        });
        isValid = anthropicRes.status !== 401;
        break;
      }
      case "glm":
      case "glm-cn":
      case "alims-intl":
      case "agentrouter": {
        const cfg = PROVIDERS[provider];
        const isOpenAiFormat = provider === "glm-cn" || provider === "alims-intl";
        if (isOpenAiFormat) {
          const testModel = getDefaultModel(provider);
          const res = await fetch(cfg.baseUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ model: testModel, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
          });
          isValid = res.status !== 401 && res.status !== 403;
        } else {
          const testModel = getDefaultModel(provider) || "claude-sonnet-4-20250514";
          const res = await fetch(cfg.baseUrl, {
            method: "POST",
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(cfg.headers || {}) },
            body: JSON.stringify({ model: testModel, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
          });
          // 400 = model resolution error but auth passed (e.g. agentrouter "no available channel")
          isValid = res.status !== 401 && res.status !== 403;
        }
        break;
      }
      case "deepseek":
      case "mistral":
      case "hyperbolic":
      case "assemblyai":
      case "nanobanana": {
        const endpoints: Record<string, string> = {
          ...Object.fromEntries(Object.entries(PROVIDERS as Record<string, any>).filter(([, t]: any[]) => t.validateUrl).map(([id, t]: any[]) => [id, t.validateUrl])),
        };
        const headers: Record<string, string> = {};
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const res = await fetch(endpoints[provider], { headers, signal: AbortSignal.timeout(8000) });
        isValid = res.ok;
        break;
      }
      // OpenCode accounts hold an optional API key for paid models.
      case "opencode":
      case "opencode-go": {
        const res = await fetch("https://opencode.ai/inference/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: getDefaultModel("opencode-go"), messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
        });
        isValid = res.status !== 401 && res.status !== 403;
        break;
      }
      case "commandcode": {
        const cfg = PROVIDERS.commandcode;
        const model = getDefaultModel("commandcode");
        const payload = openaiToCommandCodeRequest(model, {
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false,
        }, false);
        const res = await fetch(cfg.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cfg.headers || {}),
            "x-session-id": crypto.randomUUID(),
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        });
        isValid = res.status !== 401 && res.status !== 403;
        break;
      }
      case "deepgram": {
        const res = await fetch("https://api.deepgram.com/v1/projects", { headers: { Authorization: `Token ${apiKey}` } });
        isValid = res.ok;
        break;
      }
      case "grok-web": {
        const token = apiKey.startsWith("sso=") ? apiKey.slice(4) : apiKey;
        const randomHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
        const statsigId = Buffer.from("e:TypeError: Cannot read properties of null (reading 'children')").toString("base64");
        const res = await fetch("https://grok.com/rest/app-chat/conversations/new", {
          method: "POST",
          headers: {
            Accept: "*/*",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Content-Type": "application/json",
            Cookie: `sso=${token}`,
            Origin: "https://grok.com",
            Pragma: "no-cache",
            Referer: "https://grok.com/",
            "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"macOS"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            "x-statsig-id": statsigId,
            "x-xai-request-id": crypto.randomUUID(),
            traceparent: `00-${randomHex(16)}-${randomHex(8)}-00`,
          },
          body: JSON.stringify({
            temporary: true, modelName: "grok-4", message: "ping",
            fileAttachments: [] as any[], imageAttachments: [] as any[],
            disableSearch: false, enableImageGeneration: false, returnImageBytes: false,
            returnRawGrokInXaiRequest: false, enableImageStreaming: false, imageGenerationCount: 0,
            forceConcise: false, toolOverrides: {} as Record<string, any>, enableSideBySide: true, sendFinalMetadata: true,
            isReasoning: false, disableTextFollowUps: true, disableMemory: true,
            forceSideBySide: false, isAsyncChat: false, disableSelfHarmShortCircuit: false,
          }),
        });
        if (res.status === 401 || res.status === 403) {
          isValid = false;
          error = "Invalid SSO cookie — re-paste from grok.com DevTools → Cookies → sso";
        } else {
          isValid = true;
        }
        break;
      }
      case "perplexity-web": {
        let sessionToken = apiKey;
        if (sessionToken.startsWith("__Secure-next-auth.session-token=")) {
          sessionToken = sessionToken.slice("__Secure-next-auth.session-token=".length);
        }
        const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
        const res = await fetch("https://www.perplexity.ai/rest/sse/perplexity_ask", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Origin: "https://www.perplexity.ai",
            Referer: "https://www.perplexity.ai/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            "X-App-ApiClient": "default",
            "X-App-ApiVersion": "2.18",
            Cookie: `__Secure-next-auth.session-token=${sessionToken}`,
          },
          body: JSON.stringify({
            query_str: "ping",
            params: {
              query_str: "ping", search_focus: "internet", mode: "concise", model_preference: "pplx_pro",
              sources: ["web"], attachments: [] as any[],
              frontend_uuid: crypto.randomUUID(), frontend_context_uuid: crypto.randomUUID(),
              version: "2.18", language: "en-US", timezone: tz,
              search_recency_filter: null, is_incognito: true, use_schematized_api: true, last_backend_uuid: null,
            },
          }),
        });
        if (res.status === 401 || res.status === 403) {
          isValid = false;
          error = "Invalid session cookie — re-paste __Secure-next-auth.session-token from perplexity.ai";
        } else {
          isValid = true;
        }
        break;
      }
      default: {
        // Generic probe for OpenAI-compatible providers (config-driven from PROVIDERS)
        const cfg = PROVIDERS[provider];
        if (!cfg || cfg.format !== "openai" || !cfg.baseUrl) {
          return { status: 400, payload: { error: "Provider validation not supported" } };
        }
        if (cfg.noAuth) { isValid = true; break; }
        const headers: Record<string, string> = { "Content-Type": "application/json", ...(cfg.headers || {}) };
        if (cfg.authHeader === "x-api-key") headers["X-API-Key"] = apiKey;
        else headers.Authorization = `Bearer ${apiKey}`;
        const modelsUrl = cfg.baseUrl.replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models");
        let probeOk: boolean | null = null;
        try {
          const probeRes = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(8000) });
          if (probeRes.status === 401 || probeRes.status === 403) probeOk = false;
          else if (probeRes.ok) probeOk = true;
        } catch { /* fallback to chat */ }
        if (probeOk !== null) { isValid = probeOk; break; }
        const defaultModel = getDefaultModel(provider) || "test";
        const chatRes = await fetch(cfg.baseUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
          signal: AbortSignal.timeout(10000),
        });
        isValid = chatRes.status !== 401 && chatRes.status !== 403;
        break;
      }
    }
  } catch (err: any) {
    error = (err as Error).message;
    isValid = false;
  }

  return { status: 200, payload: { valid: isValid, error: isValid ? null : (error || "Invalid API key") } };
}
