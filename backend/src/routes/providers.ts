import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { ProviderConnection } from "../db/repositories";
import { getProviderCatalog, getProviderMetadata, isCompatibleProvider, providerAcceptsApiKey, providerRequiresCredential, resolveProviderId } from "../services/providers/providerCatalog";
import { discoverProviderModels, type ProviderProbeResult } from "../services/providers/providerDiscovery";
import { testSingleConnection } from "../services/providers/connectionTest";
import { onAutoclawConnectionChanged } from "../services/billing/autoclawTasksScheduler";
import { onCodebuddyConnectionChanged } from "../services/providers/codebuddyProbeScheduler";
import { createProbe407Job, deleteProbe407Damaged, getProbe407Job, listProbe407Damaged, normalizeProbeConcurrency, normalizeProbeTimeoutMs } from "../services/providers/grokCliProbe407";
import { fetchAutoclawAccount } from "../services/providers/autoclawIdentity";
import { fetchExperientialLabsAccount } from "../services/providers/experientialLabsIdentity";
import { autoclawRefresh } from "../services/chat/autoclawExecutor";
import { authenticateRiver } from "../services/providers/riverAuth.ts";
import { computeProviderQuotaSummary } from "../services/billing/quotaSummary";
import { positiveLimit } from "../services/chat/inFlightSlots";
// The v1 model registry is JavaScript and intentionally remains the source of truth.
import { getModelsByProviderId } from "../services/providers/config/providerModels.ts";
import { ALIMS_EXHAUSTED_MARKER_PREFIX, ALIMS_INTL_PROVIDER, alimsExhaustedMarkerKey, isAlimsModelExhausted } from "../services/providers/alimsFreeTier.js";

function safe(connection: ProviderConnection) {
  const data = { ...connection.data } as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (/key|token|secret|cookie|password|credential|authorization/i.test(key)) delete data[key];
  }
  return {
    ...data,
    id: connection.id,
    provider: connection.provider,
    authType: connection.authType,
    name: connection.name,
    email: connection.email,
    priority: connection.priority,
    isActive: connection.isActive,
    data,
    credentials: {} as Record<string, any>,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function exportCodexAccount(connection: ProviderConnection) {
  // Current refresh flows persist new tokens in data, so it must override the
  // original credential values when both copies exist.
  const values = { ...connection.credentials, ...connection.data } as Record<string, unknown>;
  return {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: stringValue(values.idToken, values.id_token),
      access_token: stringValue(values.accessToken, values.access_token),
      refresh_token: stringValue(values.refreshToken, values.refresh_token),
      account_id: stringValue(values.chatgptAccountId, values.chatgpt_account_id, values.accountId, values.account_id, values.workspaceId, values.workspace_id),
    },
    last_refresh: stringValue(values.lastRefreshAt, values.last_refresh),
  };
}

function exportQoderPat(connection: ProviderConnection): string | null {
  const values = { ...connection.credentials, ...connection.data } as Record<string, unknown>;
  const nested = values.providerSpecificData && typeof values.providerSpecificData === "object"
    ? values.providerSpecificData as Record<string, unknown>
    : {};
  return stringValue(
    values.personalAccessToken,
    values.personal_access_token,
    nested.personalAccessToken,
    nested.personal_access_token,
  );
}

function exportCodebuddyIntlToken(connection: ProviderConnection): { access_token: string | null; refresh_token: string | null } | null {
  const values = { ...connection.credentials, ...connection.data } as Record<string, unknown>;
  const accessToken = stringValue(values.accessToken, values.access_token);
  const refreshToken = stringValue(values.refreshToken, values.refresh_token);
  if (!accessToken && !refreshToken) return null;
  return { access_token: accessToken, refresh_token: refreshToken };
}

// v1 PUT /api/providers/[id] accepts v1's flat connection fields at the top
// level of the body; map them into the v2 data bag (sparse: only when present).
const V1_FLAT_DATA_FIELDS = ["group", "defaultModel", "globalPriority", "testStatus", "lastError", "lastErrorAt", "apiKey"] as const;

function v1FlatDataPatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of V1_FLAT_DATA_FIELDS) {
    if (body[field] !== undefined) patch[field] = body[field];
  }
  const providerSpecificData = body.providerSpecificData;
  if (providerSpecificData && typeof providerSpecificData === "object") {
    Object.assign(patch, providerSpecificData as Record<string, unknown>);
  }
  return patch;
}

export function providerRoutes(runtime: Runtime) {
  const resolve = (id: string) => runtime.repos.providers.get(id) || runtime.repos.providers.list(true).find((provider) => provider.provider === resolveProviderId(id));

  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", (c) => {
      const providerFilter = c.req.query("provider");
      const hasPage = c.req.query("page") !== undefined;
      const hasPageSize = c.req.query("pageSize") !== undefined;
      if (!hasPage && !hasPageSize && !providerFilter) {
        return c.json({ connections: runtime.repos.providers.list(true).map(safe) });
      }
      const settings = runtime.repos.settings.get() as { quotaPageSize?: number };
      const maxPageSize = Math.min(Math.max(1, Number(settings.quotaPageSize) || 100), 500);
      const page = parsePositiveInt(c.req.query("page"), 1);
      const requestedPageSize = parsePositiveInt(c.req.query("pageSize"), maxPageSize);
      const pageSize = Math.min(requestedPageSize, maxPageSize);
      const all = runtime.repos.providers.list(true);
      const filtered = providerFilter
        ? all.filter((connection) => connection.provider === providerFilter)
        : all;
      const sorted = filtered.sort((a, b) => (a.priority || 0) - (b.priority || 0));
      const total = sorted.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const currentPage = Math.min(page, totalPages);
      const offset = (currentPage - 1) * pageSize;
      return c.json({
        connections: sorted.slice(offset, offset + pageSize).map(safe),
        pagination: { page: currentPage, pageSize, total, totalPages },
      });
    })
    .get("/catalog", (c) => {
      const kind = c.req.query("kind")?.trim();
      const providers = getProviderCatalog()
        .filter((provider) => !provider.hidden && (!kind || (provider.serviceKinds.includes(kind) && !provider.hiddenKinds.includes(kind))))
        .sort((left, right) => (left.priority !== 999 ? left.priority : left.mediaPriority ?? 999) - (right.priority !== 999 ? right.priority : right.mediaPriority ?? 999))
        .map((provider) => ({ id: provider.id, alias: provider.alias, name: provider.name, noAuth: provider.noAuth, serviceKinds: provider.serviceKinds, display: provider.display }));
      return c.json({ providers });
    })
    .post("/export/codex", async (c) => {
      const body = await c.req.json<{ connectionIds?: unknown }>().catch((): { connectionIds?: unknown } => ({}));
      const selectedIds = new Set(Array.isArray(body.connectionIds) ? body.connectionIds.filter((id: unknown): id is string => typeof id === "string") : []);
      const accounts = runtime.repos.providers.list(true)
        .filter((connection) => selectedIds.has(connection.id) && connection.provider === "codex" && connection.authType === "oauth" && connection.isActive !== false)
        .map(exportCodexAccount);
      return c.json(accounts);
    })
    .post("/export/qoder", async (c) => {
      const body = await c.req.json<{ connectionIds?: unknown }>().catch((): { connectionIds?: unknown } => ({}));
      const selectedIds = new Set(Array.isArray(body.connectionIds) ? body.connectionIds.filter((id: unknown): id is string => typeof id === "string") : []);
      const pats = runtime.repos.providers.list(true)
        .filter((connection) => selectedIds.has(connection.id) && connection.provider === "qoder" && connection.authType === "oauth" && connection.isActive !== false)
        .map(exportQoderPat)
        .filter((pat): pat is string => pat !== null)
        .map((pat) => pat.trim())
        .filter((pat) => Boolean(pat) && !/[\r\n]/.test(pat));
      if (pats.length === 0) return c.json({ error: "No selected active Qoder connections contain a Personal Access Token" }, 400);
      return c.body(pats.join("\n"), 200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    })
    .post("/export/codebuddy-intl-cli", async (c) => {
      const body = await c.req.json<{ connectionIds?: unknown }>().catch((): { connectionIds?: unknown } => ({}));
      const selectedIds = new Set(Array.isArray(body.connectionIds) ? body.connectionIds.filter((id: unknown): id is string => typeof id === "string") : []);
      const tokens = runtime.repos.providers.list(true)
        .filter((connection) => selectedIds.has(connection.id) && connection.provider === "codebuddy-intl-cli" && connection.isActive !== false)
        .map(exportCodebuddyIntlToken)
        .filter((token): token is { access_token: string | null; refresh_token: string | null } => token !== null)
        .map((token) => token.refresh_token)
        .filter((token): token is string => token !== null)
        .map((token) => token.trim())
        .filter((token) => Boolean(token) && !/[\r\n]/.test(token));
      if (tokens.length === 0) return c.json({ error: "No selected active CodeBuddy Intl CLI connections contain a refresh token" }, 400);
      return c.body(tokens.join("\n"), 200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    })
    .post("/export/api-keys", async (c) => {
      const body = await c.req.json<{ connectionIds?: unknown }>().catch((): { connectionIds?: unknown } => ({}));
      const selectedIds = new Set(Array.isArray(body.connectionIds) ? body.connectionIds.filter((id: unknown): id is string => typeof id === "string") : []);
      const lines = runtime.repos.providers.list(true)
        .filter((connection) => selectedIds.has(connection.id) && connection.authType === "apikey")
        .map((connection) => {
          const key = stringValue(connection.credentials.apiKey, connection.data?.apiKey)?.trim();
          if (!key || /[\r\n]/.test(key)) return null;
          if (connection.provider !== "river") return key;
          // River round-trips the optional wallet session in the bulk format.
          const refreshToken = stringValue(connection.data?.riverRefreshToken, connection.data?.refreshToken)?.trim();
          const clientId = stringValue(connection.data?.riverClientId, connection.data?.clientId)?.trim();
          const name = connection.name?.trim();
          const prefix = name ? `${name}|` : "";
          return refreshToken && clientId ? `${prefix}${key}|${refreshToken}:${clientId}` : `${prefix}${key}`;
        })
        .filter((line): line is string => line !== null);
      const unique = [...new Set(lines)];
      if (unique.length === 0) return c.json({ error: "No selected connections contain an API key" }, 400);
      return c.body(unique.join("\n"), 200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    })
    .post("/export/alims-api-keys", (c) => {
      const keys = runtime.repos.providers.list(true)
        .filter((connection) => connection.provider === "alims-intl" && connection.isActive !== false)
        .map((connection) => stringValue(connection.credentials.apiKey, connection.data?.apiKey, connection.data?.api_access_key))
        .filter((key): key is string => key !== null)
        .map((key) => key.trim())
        .filter((key) => Boolean(key) && !/[\r\n]/.test(key));
      if (keys.length === 0) return c.json({ error: "No active Alibaba Studio connections contain an API key" }, 400);
      return c.body(keys.join("\n"), 200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    })
    .post("/grok-cli/probe-407", async (c) => {
      const body = await c.req.json<{ connectionIds?: unknown; model?: unknown; timeoutMs?: unknown; concurrency?: unknown }>().catch((): { connectionIds?: unknown; model?: unknown; timeoutMs?: unknown; concurrency?: unknown } => ({}));
      const connectionIds = Array.isArray(body.connectionIds)
        ? body.connectionIds.filter((id: unknown): id is string => typeof id === "string")
        : [];
      if (!connectionIds.length) return c.json({ error: "No connections selected." }, 400);
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
      const job = createProbe407Job(runtime, connectionIds, model, normalizeProbeTimeoutMs(body.timeoutMs), normalizeProbeConcurrency(body.concurrency));
      return c.json(job);
    })
    .get("/grok-cli/probe-407/:jobId", (c) => {
      const job = getProbe407Job(c.req.param("jobId"));
      if (!job) return c.json({ error: "Job not found" }, 404);
      return c.json(job);
    })
    .get("/grok-cli/damaged", (c) => c.json({ ids: listProbe407Damaged(runtime).map((connection) => connection.id) }))
    .post("/grok-cli/delete-damaged", (c) => c.json(deleteProbe407Damaged(runtime)))
    .get("/alims-intl/model-availability", (c) => {
      // Alibaba Studio free-tier matrix: for every registered model, count how
      // many accounts still have free quota and how many are exhausted (marked
      // by a 403 AllocationQuota.FreeTierOnly during a chat request). Models
      // that carry a marker but are absent from the registry are included too,
      // so the dashboard never hides an exhausted model.
      const connections = runtime.repos.providers.list(true).filter((connection) => connection.provider === ALIMS_INTL_PROVIDER);
      const active = connections.filter((connection) => connection.isActive !== false);
      const known = new Map<string, string>();
      for (const model of getModelsByProviderId(ALIMS_INTL_PROVIDER) as Array<{ id?: string; name?: string }>) {
        const id = String(model.id);
        known.set(id, model.name || id);
      }
      for (const connection of active) {
        for (const [key, value] of Object.entries(connection.data as Record<string, unknown>)) {
          if (!value || !key.startsWith(ALIMS_EXHAUSTED_MARKER_PREFIX)) continue;
          const model = key.slice(ALIMS_EXHAUSTED_MARKER_PREFIX.length);
          if (model && model !== "__all" && !known.has(model)) known.set(model, model);
        }
      }
      const models = [...known.entries()].map(([id, name]) => {
        let exhausted = 0;
        for (const connection of active) {
          if (isAlimsModelExhausted(connection.data as Record<string, unknown>, id)) exhausted += 1;
        }
        return { id, name, total: active.length, exhausted, available: active.length - exhausted };
      });
      return c.json({ provider: ALIMS_INTL_PROVIDER, totalAccounts: active.length, models });
    })
    .post("/alims-intl/model-availability/reset", async (c) => {
      // Manual reset: clears the sticky free-tier markers for one model (or all
      // models when omitted) across Alibaba Studio accounts.
      const body = await c.req.json<{ model?: string }>().catch((): { model?: string } => ({}));
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
      let reset = 0;
      for (const connection of runtime.repos.providers.list(true)) {
        if (connection.provider !== ALIMS_INTL_PROVIDER) continue;
        const cleared: Record<string, null> = {};
        for (const [key, value] of Object.entries(connection.data)) {
          if (!key.startsWith(ALIMS_EXHAUSTED_MARKER_PREFIX)) continue;
          if (model && key !== alimsExhaustedMarkerKey(model)) continue;
          if (value) cleared[key] = null;
        }
        if (!Object.keys(cleared).length) continue;
        runtime.repos.providers.patch(connection.id, { data: cleared });
        reset += 1;
      }
      return c.json({ ok: true, reset, model });
    })
    .post("/", async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      const provider = resolveProviderId(String(body.provider || ""));
      const metadata = getProviderMetadata(provider);
      if (!provider || (!metadata && !isCompatibleProvider(provider))) return c.json({ error: "Invalid provider" }, 400);
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      const authType = String(body.authType || (metadata?.authModes[0] === "cookie" ? "cookie" : metadata?.authModes[0] || "apikey"));
      if (providerRequiresCredential(metadata) && !apiKey && !body.credentials && !body.accessToken && authType !== "oauth") {
        return c.json({ error: `${authType === "cookie" ? "Cookie value" : "API Key"} is required` }, 400);
      }
      // Bulk-add dedup: if an active connection for this provider already
      // holds the same API key, skip silently (return the existing connection
      // as a 200, so bulk flows never error or create duplicates). AutoClaw
      // keys are refresh tokens persisted under a different field, so it is
      // excluded from this apiKey-equality check. Experiential Labs dedups on
      // org_slug as well (resolved below), but keeps this check as a backstop
      // for when whoami is unreachable.
      if (apiKey && authType === "apikey" && provider !== "autoclaw") {
        const duplicate = runtime.repos.providers.list(true).find((connection) => connection.provider === provider && connection.isActive && String(connection.data?.apiKey || "") === apiKey);
        if (duplicate) return c.json({ connection: safe(duplicate) }, 200);
      }
      if (isCompatibleProvider(provider) && !runtime.repos.nodes.get(provider)) return c.json({ error: "Compatible node not found" }, 404);
      const input = {
        ...body,
        provider,
        authType,
        credentials: { ...((body.credentials || {}) as Record<string, unknown>), ...(apiKey ? { apiKey } : {}) },
        // v1's create persists testStatus/defaultModel/proxyPoolId/group alongside the key.
        data: {
          ...((body.data || {}) as Record<string, unknown>),
          ...((body.providerSpecificData || {}) as Record<string, unknown>),
          ...v1FlatDataPatch(body),
          ...(body.proxyPoolId !== undefined ? { proxyPoolId: (body.proxyPoolId || null) as string | null } : {}),
        },
      };
      if (isCompatibleProvider(provider)) {
        const node = runtime.repos.nodes.get(provider)!;
        Object.assign(input, {
          baseUrl: node.baseUrl,
          ...(node.type === "openai-compatible" ? { apiType: node.apiType } : {}),
        });
        Object.assign(input.data, {
          prefix: node.prefix,
          ...(node.type === "openai-compatible" ? { apiType: node.apiType } : {}),
          baseUrl: node.baseUrl,
          nodeName: node.name,
        });
      }
      if (provider === "river") {
        // River wallet reads need a console session, not the inference key.
        // Both values are optional: without them the row stays valid but the
        // credit counter shows "-". Authentication is best-effort on create.
        const data = input.data as Record<string, unknown>;
        const refreshToken = stringValue(data.riverRefreshToken, body.refreshToken);
        const clientId = stringValue(data.riverClientId, body.clientId);
        if (refreshToken) data.riverRefreshToken = refreshToken;
        if (clientId) data.riverClientId = clientId;
        if (refreshToken && clientId) {
          try {
            const session = await authenticateRiver(refreshToken, clientId);
            Object.assign(data, {
              riverAccessToken: session.accessToken,
              riverRefreshToken: session.refreshToken,
              riverAccessExpiresAt: session.expiresAt,
            });
            if (!(input as Record<string, unknown>).email && session.email) Object.assign(input, { email: session.email });
          } catch (error: any) {
            data.riverAuthError = error instanceof Error ? error.message : String(error);
          }
        }
        const connection = runtime.repos.providers.create(input);
        void runtime.quotaSnapshots.requestRefresh(connection.id);
        return c.json({ connection: safe(connection) }, 201);
      }
      if (provider === "autoclaw") {
        // The pasted value is a refresh token, not an API key. Initial access
        // token is unset; the executor mints it on first use via /v1/refresh.
        const data = { ...(input.data as Record<string, unknown>) };
        delete data.apiKey;
        const deviceId = typeof data.deviceId === "string" && data.deviceId
          ? data.deviceId
          : crypto.randomUUID();
        Object.assign(input, {
          credentials: {} as Record<string, any>,
          data: {
            ...data,
            refreshToken: apiKey,
            deviceId,
          },
        });
        // Identity lookup is best-effort. A temporary upstream failure must not
        // prevent an operator from saving a valid AutoClaw refresh token.
        let refreshed: Awaited<ReturnType<typeof autoclawRefresh>> = null;
        try {
          refreshed = await autoclawRefresh(apiKey, deviceId);
        } catch {
          refreshed = null;
        }
        const account = refreshed
          ? await fetchAutoclawAccount(refreshed.accessToken, deviceId)
          : null;
        if (refreshed) Object.assign(input.data, { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken });
        if (account) {
          const suppliedName = typeof body.name === "string" ? body.name.trim() : "";
          Object.assign(input, { email: account.email, name: suppliedName || account.email });
          Object.assign(input.data, { autoclawUserId: account.userId });
        }
        const existing = account
          ? runtime.repos.providers.list(true).find((connection) => connection.provider === "autoclaw" && connection.email?.toLowerCase() === account.email)
          : null;
        const connection = existing
          ? runtime.repos.providers.update(existing.id, { ...input, isActive: true }) ?? existing
          : runtime.repos.providers.create(input);
        onAutoclawConnectionChanged(runtime, connection.id);
        return c.json({ connection: safe(connection) }, existing ? 200 : 201);
      }
      if (provider === "experiential-labs") {
        // Resolve the account identity via whoami. Best-effort: a temporary
        // upstream failure must not prevent saving a valid API key.
        let account: Awaited<ReturnType<typeof fetchExperientialLabsAccount>> = null;
        if (apiKey) {
          try {
            account = await fetchExperientialLabsAccount(apiKey);
          } catch {
            account = null;
          }
        }
        if (account) {
          const suppliedName = typeof body.name === "string" ? body.name.trim() : "";
          // Auto-generated bulk names ("Key 1", "Key 2", …) never win over the
          // resolved identity: the row is named by org_slug instead. An
          // explicitly typed name is still respected.
          const isAutoName = /^key \d+$/i.test(suppliedName);
          Object.assign(input, { name: !suppliedName || isAutoName ? account.orgSlug : suppliedName });
          Object.assign(input.data, { experientialLabsOrgId: account.orgId, experientialLabsOrgSlug: account.orgSlug, experientialLabsOrgName: account.orgName });
          const existing = runtime.repos.providers.list(true).find((connection) => connection.provider === "experiential-labs" && String(connection.data?.experientialLabsOrgSlug || "").toLowerCase() === account.orgSlug);
          if (existing) {
            const connection = runtime.repos.providers.update(existing.id, { ...input, isActive: true }) ?? existing;
            return c.json({ connection: safe(connection) }, 200);
          }
        }
        const connection = runtime.repos.providers.create(input);
        return c.json({ connection: safe(connection) }, 201);
      }
      const connection = runtime.repos.providers.create(input);
      if (connection.provider === "autoclaw") onAutoclawConnectionChanged(runtime, connection.id);
      if (connection.provider === "codebuddy-intl-cli") onCodebuddyConnectionChanged(runtime);
      return c.json({ connection: safe(connection) }, 201);
    })
    .get("/:id/quota-summary", (c) => {
      const providerId = resolveProviderId(c.req.param("id"));
      const allProviderConnections = runtime.repos.providers
        .list(true)
        .filter((connection) => connection.provider === providerId);
      const activeConnections = allProviderConnections.filter((c) => c.isActive !== false);
      const inactiveConnections = allProviderConnections.filter((c) => c.isActive === false);
      const snapshots = activeConnections
        .map((connection) => runtime.repos.quotaSnapshots.get(connection.id))
        .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null);
      return c.json(computeProviderQuotaSummary(
        providerId,
        activeConnections.length,
        snapshots,
        activeConnections.length,
        inactiveConnections.length,
      ));
    })
    .get("/:id/models", async (c) => {
       const provider = resolve(c.req.param("id"));
       const providerId = provider ? provider.provider : resolveProviderId(c.req.param("id"));
       const catalogModels = getProviderMetadata(providerId)?.models || [];
       if (!provider && !getModelsByProviderId(providerId).length && !catalogModels.length) return c.json({ error: "Provider not found" }, 404);
       const rawDiscovery: ProviderProbeResult = provider ? await discoverProviderModels(provider, runtime) : { ok: true, models: getModelsByProviderId(providerId) };
       const discovered = { ok: rawDiscovery.ok, error: "error" in rawDiscovery ? rawDiscovery.error : undefined, models: (rawDiscovery.models || []) as Array<{ id?: string; name?: string }> };
       if (provider && discovered.models) {
         runtime.repos.providers.patch(provider.id, { data: { models: discovered.models.map((model) => String(model.id)), modelsFetchedAt: new Date().toISOString(), modelDiscoveryError: discovered.ok ? null : discovered.error } });
       }
       const staticModels = (discovered.models?.length ? discovered.models : (getModelsByProviderId(providerId).length ? getModelsByProviderId(providerId) : catalogModels)).map((model: { id?: string; name?: string }) => ({ id: String(model.id), name: model.name || model.id, object: "model", owned_by: providerId }));
       const customModels = runtime.repos.models.all().filter((model) => model.provider === providerId || model.providerAlias === c.req.param("id")).map((model) => ({ id: String(model.id || model.model), name: String(model.name || model.model || model.id), object: "model", owned_by: providerId }));
       const data = [...staticModels, ...customModels].filter((model, index, rows) => rows.findIndex((candidate) => candidate.id === model.id) === index);
       return c.json({ object: "list", data });
     })
    .post("/:id/test", async (c) => {
      // v1 testSingleConnection: per-provider probes, token refresh, proxy pre-test,
      // and v1 persistence semantics (testStatus "active"/"error").
      try {
        const result = await testSingleConnection(runtime, c.req.param("id"));
        if (result.error === "Connection not found") return c.json({ error: "Connection not found" }, 404);
        return c.json({ valid: result.valid, error: result.error, refreshed: result.refreshed, mergedDuplicates: result.mergedDuplicates || 0 });
      } catch (error: any) {
        console.log("Error testing connection:", error);
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message || "Test failed" }, 500);
      }
    })
    .get("/:id", (c) => {
      const provider = resolve(c.req.param("id"));
      return provider ? c.json({ connection: safe(provider) }) : c.json({ error: "Connection not found" }, 404);
    })
    .put("/:id", async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
      const current = runtime.repos.providers.get(c.req.param("id"));
      if (!current) return c.json({ error: "Connection not found" }, 404);
      // v1 validates a non-empty proxyPoolId against the proxy pool table.
      if (body.proxyPoolId !== undefined && body.proxyPoolId !== null && body.proxyPoolId !== "" && body.proxyPoolId !== "__none__") {
        if (!runtime.repos.proxies.get(String(body.proxyPoolId))) return c.json({ error: "Proxy pool not found" }, 400);
      }
      // providers.update merges `data` one level deep over the stored data,
      // so only the edited fields go in.
      const provider = runtime.repos.providers.update(c.req.param("id"), {
        ...body,
        data: {
          ...((body.data || {}) as Record<string, unknown>),
          ...v1FlatDataPatch(body),
          ...(body.proxyPoolId !== undefined ? { proxyPoolId: (body.proxyPoolId === "__none__" ? null : (body.proxyPoolId || null)) as string | null } : {}),
          // Per-Connection in-flight limit. Empty, zero or invalid clears it (no limit).
          ...(body.maxInFlight !== undefined ? { maxInFlight: positiveLimit(body.maxInFlight) } : {}),
        },
      });
      if (current.provider === "autoclaw") onAutoclawConnectionChanged(runtime, current.id);
      if (current.provider === "codebuddy-intl-cli") onCodebuddyConnectionChanged(runtime);
      return provider ? c.json({ connection: safe(provider) }) : c.json({ error: "Connection not found" }, 404);
    })
     .delete("/:id", (c) => runtime.repos.providers.remove(c.req.param("id")) ? c.json({ message: "Connection deleted successfully" }) : c.json({ error: "Connection not found" }, 404));
}
