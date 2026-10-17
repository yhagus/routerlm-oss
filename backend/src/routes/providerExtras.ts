import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { ConnectionPatch, ProviderConnection } from "../db/repositories";
import { getProviderMetadata, isUsageApiKeyProvider, isUsageSupportedProvider, resolveProviderId, usageSupportedProviderIds } from "../services/providers/providerCatalog";
import { discoverProviderModels } from "../services/providers/providerDiscovery";
import { customNodeType } from "../services/providers/customNodes";
import { testSingleConnection, validateProviderApiKey } from "../services/providers/connectionTest";
import { pingModelByKind } from "../services/providers/modelPing";
import { fetchCodebuddyAccount, isCodebuddyProvider } from "../services/providers/codebuddyIdentity";
import { providerTokenRefresh, refreshAfterAuthFailure } from "../services/providers/refreshCoordinator";
// The v1 model registry is JavaScript and intentionally remains the source of truth.
import { PROVIDER_ID_TO_ALIAS, getModelsByProviderId } from "../services/providers/config/providerModels.ts";

// Free OpenCode models that don't use the "-free" id suffix (v1 filters.js).
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

const CLIENT_SAFE_FIELDS = [
  "id", "provider", "authType", "name", "email", "displayName",
  "priority", "globalPriority", "isActive", "defaultModel", "group",
  "testStatus", "lastError", "lastErrorAt", "errorCode",
  "expiresAt", "lastUsedAt", "consecutiveUseCount",
  "createdAt", "updatedAt",
];

const CLIENT_SAFE_PSD_FIELDS = [
  "baseUrl", "accountId",
  "region", "projectId", "resourceUrl", "proxyPoolId",
  "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy",
  "githubLogin", "githubName", "githubEmail", "githubUserId",
  "codebuddyUserId", "codebuddyNickname", "codebuddyEnterpriseName",
  "username", "firstName", "lastName", "authMethod", "authKind",
];

function maskName(name: unknown): unknown {
  if (typeof name !== "string" || name.length <= 16) return name;
  if (/[a-zA-Z0-9_-]{32,}/.test(name)) return `${name.slice(0, 8)}***`;
  return name;
}

function clientSanitize(connection: ProviderConnection) {
  const flat: Record<string, unknown> = {
    ...connection.data,
    id: connection.id,
    provider: connection.provider,
    authType: connection.authType,
    name: connection.name,
    email: connection.email,
    priority: connection.priority,
    isActive: connection.isActive,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
  const safe: Record<string, unknown> = {};
  for (const field of CLIENT_SAFE_FIELDS) if (flat[field] !== undefined) safe[field] = flat[field];
  if (safe.name) safe.name = maskName(safe.name);
  const psd: Record<string, unknown> = {};
  for (const field of CLIENT_SAFE_PSD_FIELDS) {
    if (field === "baseUrl") {
      if (connection.baseUrl != null || connection.data.baseUrl !== undefined) psd.baseUrl = connection.baseUrl ?? connection.data.baseUrl;
      continue;
    }
    if (connection.data[field] !== undefined) psd[field] = connection.data[field];
  }
  safe.providerSpecificData = psd;
  return safe;
}

function isUsageEligible(connection: ProviderConnection): boolean {
  return isUsageSupportedProvider(connection.provider) && (
    connection.authType === "oauth" || isUsageApiKeyProvider(connection.provider)
  );
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sortConnections(connections: ProviderConnection[], sort: string, usageOrder: string[]): ProviderConnection[] {
  const list = [...connections];
  if (sort === "provider") {
    return list.sort((a, b) => {
      const orderA = usageOrder.indexOf(a.provider);
      const orderB = usageOrder.indexOf(b.provider);
      if (orderA !== orderB) return orderA - orderB;
      return a.provider.localeCompare(b.provider);
    });
  }
  return list.sort((a, b) => {
    const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
    const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (a.provider || "").localeCompare(b.provider);
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const padded = part.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

let codexBackfillDone = false;

// v1 backfills codex account identity from the stored id_token once per process
// so the client list can show emails without a refetch.
function backfillCodexEmails(runtime: Runtime) {
  if (codexBackfillDone) return;
  codexBackfillDone = true;
  try {
    for (const connection of runtime.repos.providers.list(true)) {
      if (connection.provider !== "codex" || connection.authType !== "oauth") continue;
      const idToken = connection.credentials.idToken ?? connection.data.idToken;
      if (typeof idToken !== "string" || !idToken) continue;
      if (connection.email && connection.data.chatgptAccountId) continue;
      const payload = decodeJwtPayload(idToken);
      if (!payload) continue;
      const chatgpt = (payload["https://api.openai.com/auth"] || {}) as Record<string, unknown>;
      const email = typeof payload.email === "string" ? payload.email : undefined;
      const chatgptAccountId = chatgpt.chatgpt_account_id ?? payload.account_id;
      const chatgptPlanType = chatgpt.chatgpt_plan_type ?? payload.plan_type;
      if (!email && !chatgptAccountId) continue;
      const patch: ConnectionPatch = {};
      if (!connection.email && email) patch.email = email;
      if (chatgptAccountId || chatgptPlanType) patch.data = { chatgptAccountId, chatgptPlanType };
      if (Object.keys(patch).length) runtime.repos.providers.patch(connection.id, patch);
    }
  } catch {
    codexBackfillDone = false;
  }
}

let codebuddyBackfillDone = false;

// Backfill the CodeBuddy account identity (uid/nickname) for existing OAuth
// connections that predate identity capture, so re-logins dedupe on the same
// account. Mirrors backfillCodexEmails, but needs a network fetch + refresh.
function backfillCodebuddyIdentity(runtime: Runtime) {
  if (codebuddyBackfillDone) return;
  codebuddyBackfillDone = true;
  void (async () => {
    try {
      for (const connection of runtime.repos.providers.list(true)) {
        if (!isCodebuddyProvider(connection.provider) || connection.authType !== "oauth") continue;
        if (connection.data.codebuddyUserId) continue;
        let accessToken = typeof connection.credentials.accessToken === "string" ? connection.credentials.accessToken : "";
        if (!accessToken) accessToken = (await refreshAfterAuthFailure(runtime, connection.id, null, { refresh: providerTokenRefresh }))?.accessToken || "";
        if (!accessToken) continue;
        let account = await fetchCodebuddyAccount(connection.provider, accessToken);
        if (!account?.uid && typeof connection.credentials.refreshToken === "string" && connection.credentials.refreshToken) {
          const retryToken = (await refreshAfterAuthFailure(runtime, connection.id, accessToken, { refresh: providerTokenRefresh }))?.accessToken || "";
          if (retryToken && retryToken !== accessToken) {
            accessToken = retryToken;
            account = await fetchCodebuddyAccount(connection.provider, accessToken);
          }
        }
        if (!account?.uid) continue;
        const patch: ConnectionPatch = {
          data: {
            codebuddyUserId: account.uid,
            codebuddyNickname: account.nickname,
            ...(account.enterpriseName ? { codebuddyEnterpriseName: account.enterpriseName } : {}),
          },
        };
        if (!connection.name && account.nickname) patch.name = account.nickname;
        runtime.repos.providers.patch(connection.id, patch);
      }
    } catch {
      codebuddyBackfillDone = false;
    }
  })();
}

// The provider sort orders by the v1 USAGE_SUPPORTED_PROVIDERS sequence.
function getUsageSupportedOrder(): string[] {
  return usageSupportedProviderIds();
}

function getAuthGroup(providerId: string, connection?: ProviderConnection): string {
  if (connection?.authType) {
    if (connection.authType === "oauth") {
      return getProviderMetadata(providerId)?.category === "free" ? "free" : "oauth";
    }
    return connection.authType;
  }
  const category = getProviderMetadata(providerId)?.category;
  if (category === "free") return "free";
  if (category === "oauth") return "oauth";
  if (category === "apikey") return "apikey";
  return "apikey";
}

function isBatchCompatibleProvider(providerId: string): boolean {
  const type = customNodeType(providerId);
  return type === "openai-compatible" || type === "anthropic-compatible";
}

export function providerExtraRoutes(runtime: Runtime) {
  const app = new Hono().use("*", runtime.auth.adminMiddleware());
  app.post("/validate", async (c) => {
    // v1 validate: per-provider probes (compatible nodes, web/media,
    // provider switch, generic registry fallback).
    const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    try {
      const outcome = await validateProviderApiKey(runtime, body);
      return c.json(outcome.payload, outcome.status as 200 | 400 | 404 | 500);
    } catch (error: any) {
      console.log("Error validating API key:", error);
      return c.json({ error: "Validation failed" }, 500);
    }
  });
  app.post("/test-jobs", async (c) => {
    const body = await c.req.json<{ providerId?: string; delayMs?: number }>().catch(() => ({} as { providerId?: string; delayMs?: number }));
    const providerId = String(body.providerId || "").trim();
    if (!providerId) return c.json({ error: "providerId is required" }, 400);
    const active = runtime.repos.connectionTestJobs.activeForProvider(providerId);
    if (active) return c.json({ error: "A connection test job is already running for this provider" }, 409);
    const connections = runtime.repos.providers.list(true)
      .filter((connection) => connection.provider === providerId)
      .sort((left, right) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt));
    if (!connections.length) return c.json({ error: "No connections to test" }, 400);
    const delayMs = body.delayMs == null ? 1000 : Number(body.delayMs);
    const job = runtime.repos.connectionTestJobs.create({
      providerId,
      delayMs: Number.isFinite(delayMs) ? delayMs : 1000,
      connectionIds: connections.map((connection) => connection.id),
    });
    return c.json(job, 201);
  });
  app.get("/test-jobs", (c) => {
    const providerId = String(c.req.query("providerId") || "").trim();
    if (!providerId) return c.json({ error: "providerId is required" }, 400);
    const job = runtime.repos.connectionTestJobs.latestForProvider(providerId);
    return job ? c.json(job) : c.json({ error: "No connection test job found" }, 404);
  });
  app.get("/test-jobs/:id", (c) => {
    const job = runtime.repos.connectionTestJobs.get(c.req.param("id"));
    return job ? c.json(job) : c.json({ error: "Connection test job not found" }, 404);
  });
  app.post("/test-jobs/:id/cancel", (c) => {
    const job = runtime.repos.connectionTestJobs.requestCancel(c.req.param("id"));
    return job ? c.json(job) : c.json({ error: "Connection test job not found" }, 404);
  });
  app.post("/test-batch", async (c) => {
    try {
      const body = await c.req.json<{ mode?: string; providerId?: string }>();
      const mode = body.mode;
      if (!mode) return c.json({ error: "mode is required" }, 400);
      if (mode === "provider" && !body.providerId) return c.json({ error: "providerId is required when mode is provider" }, 400);
      if (!["provider", "oauth", "free", "apikey", "compatible", "all"].includes(mode)) return c.json({ error: "Invalid mode. Use: provider, oauth, free, apikey, compatible, all" }, 400);

      const connections = runtime.repos.providers.list(false).filter((connection) => {
        if (mode === "all") return true;
        if (mode === "provider") return connection.provider === body.providerId;
        if (mode === "compatible") return isBatchCompatibleProvider(connection.provider);
        if (mode === "apikey") return getAuthGroup(connection.provider, connection) === "apikey" || connection.authType === "api_key";
        return getAuthGroup(connection.provider, connection) === mode;
      });
      const results: any[] = [];
      for (const connection of connections) {
        try {
          // v1 test-batch runs the real per-connection test (probes + refresh + persistence).
          const result = await testSingleConnection(runtime, connection.id);
          const diagnosis = (result as typeof result & { diagnosis?: unknown }).diagnosis || null;
          results.push({ provider: connection.provider, connectionId: connection.id, connectionName: connection.name || connection.email || connection.provider, authType: connection.authType || getAuthGroup(connection.provider, connection), valid: result.valid, latencyMs: result.latencyMs || 0, error: result.error || null, diagnosis, statusCode: null, testedAt: result.testedAt || new Date().toISOString() });
        } catch (error: any) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ provider: connection.provider, connectionId: connection.id, connectionName: connection.name || connection.email || connection.provider, authType: connection.authType || getAuthGroup(connection.provider, connection), valid: false, latencyMs: 0, error: message, diagnosis: { type: "network_error", source: "local", code: null, message }, statusCode: null, testedAt: new Date().toISOString() });
        }
      }
      return c.json({ mode, providerId: body.providerId || null, results, testedAt: new Date().toISOString(), summary: { total: results.length, passed: results.filter((result) => result.valid).length, failed: results.filter((result) => !result.valid).length } });
    } catch (error: any) {
      console.log("Error in batch test:", error);
      return c.json({ error: "Batch test failed" }, 500);
    }
  });
  app.get("/suggested-models", async (c) => {
    // v1 FILTERS (src/app/api/providers/suggested-models/filters.js): only the
    // opencode-free fetcher type produces suggestions; other types 400 and the
    // frontend caches an empty list.
    const url = c.req.query("url");
    const type = c.req.query("type");
    if (!url || !type) return c.json({ error: "Missing url or type" }, 400);
    const filters: Record<string, (models: Array<Record<string, any>>) => Array<Record<string, unknown>>> = {
      "opencode-free": (models) => models
        .filter((m) => String(m.id || "").endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id))
        .map((m) => ({ id: m.id, name: m.id })),
    };
    const filter = filters[type];
    if (!filter) return c.json({ error: "Unknown filter type" }, 400);
    try {
      const res = await fetch(url);
      if (!res.ok) return c.json({ data: [] as any[]});
      const payload = await res.json() as Record<string, unknown>;
      const raw = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : Array.isArray(payload) ? payload : [];
      return c.json({ data: filter(raw.filter((item): item is Record<string, any> => item && typeof item === "object")) });
    } catch { return c.json({ data: [] as any[]}); }
  });
  app.post("/:id/test-models", async (c) => {
    try {
      const connection = runtime.repos.providers.get(c.req.param("id"));
      if (!connection) return c.json({ error: "Connection not found" }, 404);
      const providerId = connection.provider;
      const isCompatible = isBatchCompatibleProvider(providerId);
      const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
      let models = getModelsByProviderId(providerId) as Array<{ id?: string; name?: string; kind?: string; type?: string }>;
      if (isCompatible && models.length === 0) {
        try {
          const discovered = await discoverProviderModels(connection, runtime);
          models = (discovered.models || []).map((model) => ({ id: String(model.id || model.name), name: String(model.name || model.id), kind: String((model as { kind?: string; type?: string }).kind || (model as { kind?: string; type?: string }).type || "llm") }));
        } catch { /* fallback to empty */ }
      }
      if (models.length === 0) return c.json({ error: "No models configured for this provider" }, 400);
      const kindOf = (model: { kind?: string; type?: string }) => model.kind || model.type || "llm";
      // A single throwing probe must not fail the whole batch with a generic
      // 500. Report it per model with 502 (probe never completed upstream).
      const safePing = async (model: { id?: string; name?: string; kind?: string; type?: string }) => {
        try {
          const result = await pingModelByKind(runtime, `${alias}/${model.id}`, kindOf(model));
          return { modelId: model.id, name: model.name || model.id, ...result };
        } catch (error: any) {
          const message = error instanceof Error ? error.message : String(error);
          return { modelId: model.id, name: model.name || model.id, ok: false, latencyMs: 0, error: `HTTP 502: ${message}`, status: 502 };
        }
      };
      // Warm up with the first model so a token refresh completes before the
      // parallel probes; concurrent refreshes of one token race otherwise.
      const [first, ...rest] = models;
      const results = [await safePing(first)];
      if (rest.length > 0) {
        if (providerId === "grok-cli") {
          // One shared throttle covers every grok alias; parallel probes trip it.
          for (const model of rest) {
            results.push(await safePing(model));
          }
        } else {
          results.push(...await Promise.all(rest.map((model) => safePing(model))));
        }
      }
      return c.json({ provider: providerId, connectionId: connection.id, results });
    } catch (error: any) {
      return c.json({ error: error instanceof Error ? error.message : "Test failed" }, 500);
    }
  });
  app.get("/client", (c) => {
    try {
      backfillCodexEmails(runtime);
      backfillCodebuddyIdentity(runtime);
      const provider = c.req.query("provider") || "all";
      const accountStatus = c.req.query("accountStatus") || "all";
      const sort = c.req.query("sort") || "priority";
      const page = parsePositiveInt(c.req.query("page"), 1);
      const settings = runtime.repos.settings.get() as { quotaPageSize?: number };
      const maxPageSize = Math.min(Math.max(1, Number(settings.quotaPageSize) || 100), 500);
      const pageSize = Math.min(parsePositiveInt(c.req.query("pageSize"), maxPageSize), maxPageSize);
      const usageOrder = getUsageSupportedOrder();

      const eligibleConnections = runtime.repos.providers.list(true).filter(isUsageEligible);
      const providerOptions = Array.from(new Set(eligibleConnections.map((connection) => connection.provider))).sort();
      const providerFilteredConnections = eligibleConnections.filter((connection) => provider === "all" || connection.provider === provider);
      const accountFilteredConnections = providerFilteredConnections.filter((connection) => {
        if (accountStatus === "active") return connection.isActive ?? true;
        if (accountStatus === "inactive") return !(connection.isActive ?? true);
        return true;
      });
      const sortedConnections = sortConnections(accountFilteredConnections, sort, usageOrder);
      const total = sortedConnections.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const currentPage = Math.min(page, totalPages);
      const offset = (currentPage - 1) * pageSize;
      return c.json({
        connections: sortedConnections.slice(offset, offset + pageSize).map(clientSanitize),
        providerOptions,
        pagination: { page: currentPage, pageSize, total, totalPages },
        totals: { eligibleConnections: eligibleConnections.length, providerFilteredConnections: providerFilteredConnections.length },
      });
    } catch {
      return c.json({ error: "Failed to fetch providers" }, 500);
    }
  });
  return app;
}
