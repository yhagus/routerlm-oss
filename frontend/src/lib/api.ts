import type {
  ApiKey,
  ApiKeysResponse,
  AuthStatus,
  CliToolCatalogResponse,
  Combo,
  ConsoleLogsResponse,
  FreeTrackerResponse,
  PricingMap,
  QuotaResponse,
  ModelItem,
  ModelListResponse,
  ConnectionTestJob,
  ProviderConnection,
  ProviderModelTestResult,
  ProviderNode,
  ProviderQuotaSummary,
  ProxyPool,
  PublicEvent,
  PublicKeyStats,
  UsageHistoryPage,
  UsageRecord,
  UsageSummary,
  UsagePeriod,
  UsageProviderRow,
  UsageKeyRow,
  UsageEntityRow,
  UsageListResponse,
  UsageOverview,
  UsageTrend,
  UsageTrendBy,
  DashboardUsage,
  RequestDetailsResponse,
  Probe407Job,
  QueueJob,
  QueueJobsResponse,
} from "@/types/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Turns any error thrown by `request()` into an operator-facing message.
 *
 * A 401/403 means the dashboard session is missing or expired — the request
 * reached the server and was rejected, so this is NOT a network problem. Only
 * a rejected `fetch` (no HTTP response at all: DNS failure, refused connection,
 * CORS block, offline) is a genuine transport error. Keeping the two apart
 * stops auth failures from being shown as "Network error".
 */
export function describeApiError(reason: unknown): string {
  if (reason instanceof ApiError) {
    if (reason.status === 401 || reason.status === 403) {
      return "Session expired — please sign in again.";
    }
    return reason.message;
  }
  if (reason instanceof TypeError) {
    // `fetch` rejects with a TypeError when the request never completes.
    return "Network error — couldn't reach the API. Check the endpoint/connection.";
  }
  if (reason instanceof Error && reason.message) return reason.message;
  return "Network error — couldn't reach the API.";
}

export async function gatewayPost(
  path: string,
  body: Record<string, unknown> | FormData,
  signal?: AbortSignal,
  extraHeaders: HeadersInit = {},
): Promise<Response> {
  const headers = new Headers(extraHeaders);
  if (!(body instanceof FormData))
    headers.set("content-type", "application/json");
  return fetch(path, {
    method: "POST",
    headers,
    body: body instanceof FormData ? body : JSON.stringify(body),
    credentials: "include",
    signal,
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("json")
    ? await response.json().catch(() => null)
    : await response.text();
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? typeof payload.error === "string"
          ? payload.error
          : (payload.error as { message?: string })?.message
        : undefined;
    throw new ApiError(
      response.status,
      message || `Request failed with status ${response.status}`,
      payload,
    );
  }
  return payload as T;
}

const json = (value: unknown) => JSON.stringify(value);

function envelope<T>(payload: Record<string, unknown>, key: string): T {
  const value = payload[key];
  if (value === undefined)
    throw new ApiError(500, `Malformed API response: missing ${key}`, payload);
  return value as T;
}

export type UsageListFilters = {
  provider?: string;
  status?: string;
  visibility?: string;
  activity?: string;
  health?: string;
  sort?: string;
};

function listParams(
  period: string,
  page: number,
  pageSize: number,
  search: string,
  filters: UsageListFilters,
): URLSearchParams {
  const params = new URLSearchParams({
    period,
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search) params.set("search", search);
  // "all" is the server default, so omit it to keep URLs and cache keys short.
  for (const [key, value] of Object.entries(filters))
    if (value && value !== "all") params.set(key, value);
  return params;
}

export const api = {
  auth: {
    status: () =>
      request<AuthStatus>("/api/auth/status", { cache: "no-store" }),
    login: (password: string) =>
      request<{ ok: true }>("/api/auth/login", {
        method: "POST",
        body: json({ password }),
      }),
    logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  },
  version: {
    get: () =>
      request<{ currentVersion: string }>("/api/version", {
        cache: "no-store",
      }),
    shutdown: () =>
      request<{ success: boolean; message?: string }>("/api/version/shutdown", {
        method: "POST",
      }),
  },
  oauth: {
    authorize: (
      provider: string,
      redirectUri: string,
      meta?: Record<string, string>,
    ) => {
      const query = new URLSearchParams({ redirect_uri: redirectUri });
      if (meta)
        for (const [key, value] of Object.entries(meta))
          if (value) query.set(key, value);
      return request<Record<string, any>>(
        `/api/oauth/${encodeURIComponent(provider)}/authorize?${query}`,
        { cache: "no-store" },
      );
    },
    deviceCode: (provider: string, query?: string) =>
      request<Record<string, any>>(
        `/api/oauth/${encodeURIComponent(provider)}/device-code${query ? `?${query}` : ""}`,
        { cache: "no-store" },
      ),
    exchange: (provider: string, input: Record<string, unknown>) =>
      request<Record<string, unknown>>(
        `/api/oauth/${encodeURIComponent(provider)}/exchange`,
        { method: "POST", body: json(input) },
      ),
    poll: (provider: string, input: Record<string, unknown>) =>
      request<{
        success: boolean;
        error?: string;
        errorDescription?: string;
        pending?: boolean;
      }>(`/api/oauth/${encodeURIComponent(provider)}/poll`, {
        method: "POST",
        body: json(input),
      }),
    startProxy: (provider: string, query: Record<string, string> = {}) =>
      request<{
        success: boolean;
        serverSide?: boolean;
        reason?: string;
        error?: string;
      }>(
        `/api/oauth/${encodeURIComponent(provider)}/start-proxy${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ""}`,
        { cache: "no-store" },
      ),
    pollStatus: (provider: string, state: string) =>
      request<{ status: string; error?: string }>(
        `/api/oauth/${encodeURIComponent(provider)}/poll-status?${new URLSearchParams({ state })}`,
        { cache: "no-store" },
      ),
    stopProxy: (provider: string) =>
      request<{ success: boolean }>(
        `/api/oauth/${encodeURIComponent(provider)}/stop-proxy`,
        { cache: "no-store" },
      ),
    special: (path: string, input: Record<string, unknown> | unknown[] = {}) =>
      request<Record<string, unknown>>(`/api/oauth/${path}`, {
        method: "POST",
        body: json(input),
      }),
  },
  settings: {
    get: () =>
      request<Record<string, unknown>>("/api/settings", { cache: "no-store" }),
    update: (patch: Record<string, unknown>) =>
      request<Record<string, unknown>>("/api/settings", {
        method: "PATCH",
        body: json(patch),
      }),
    exportDatabase: () =>
      request<Record<string, unknown>>("/api/settings/database", {
        cache: "no-store",
      }),
    importDatabase: (payload: Record<string, unknown>) =>
      request<{ success: boolean }>("/api/settings/database", {
        method: "POST",
        body: json(payload),
      }),
    testProxy: (testUrl?: string) =>
      request<{
        ok: boolean;
        status?: number;
        elapsedMs?: number;
        error?: string;
      }>("/api/settings/proxy-test", {
        method: "POST",
        body: json({ testUrl }),
      }),
  },
  providers: {
    list: async () =>
      envelope<ProviderConnection[]>(
        await request<Record<string, unknown>>("/api/providers", {
          cache: "no-store",
        }),
        "connections",
      ),
    listPaginated: async (params: {
      provider?: string;
      page?: number;
      pageSize?: number;
    }) => {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(params)
            .filter(([, value]) => value !== undefined && value !== "")
            .map(([key, value]) => [key, String(value)]),
        ),
      );
      const payload = await request<{
        connections?: ProviderConnection[];
        pagination?: {
          page: number;
          pageSize: number;
          total: number;
          totalPages: number;
        };
      }>(`/api/providers?${qs}`, { cache: "no-store" });
      return {
        connections:
          (payload.connections as ProviderConnection[] | undefined) || [],
        pagination: payload.pagination || {
          page: 1,
          pageSize: 100,
          total: 0,
          totalPages: 1,
        },
      };
    },
    quotaSummary: (id: string) =>
      request<ProviderQuotaSummary>(
        `/api/providers/${encodeURIComponent(id)}/quota-summary`,
        { cache: "no-store" },
      ),
    catalog: (kind?: string) =>
      request<{
        providers: Array<{
          id: string;
          alias: string;
          name: string;
          noAuth: boolean;
          serviceKinds: string[];
          display: Record<string, unknown>;
        }>;
      }>(
        `/api/providers/catalog${kind ? `?${new URLSearchParams({ kind })}` : ""}`,
        { cache: "no-store" },
      ),
    create: async (input: Record<string, unknown>) =>
      envelope<ProviderConnection>(
        await request<Record<string, unknown>>("/api/providers", {
          method: "POST",
          body: json(input),
        }),
        "connection",
      ),
    get: async (id: string) =>
      envelope<ProviderConnection>(
        await request<Record<string, unknown>>(`/api/providers/${id}`, {
          cache: "no-store",
        }),
        "connection",
      ),
    update: async (id: string, input: Record<string, unknown>) =>
      envelope<ProviderConnection>(
        await request<Record<string, unknown>>(`/api/providers/${id}`, {
          method: "PUT",
          body: json(input),
        }),
        "connection",
      ),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/providers/${id}`, { method: "DELETE" }),
    models: (id: string) =>
      request<ModelListResponse>(`/api/providers/${id}/models`, {
        cache: "no-store",
      }),
    test: async (id: string) => {
      const result = await request<{
        valid: boolean;
        status?: number;
        error?: string;
        refreshed?: boolean;
      }>(`/api/providers/${id}/test`, { method: "POST" });
      return {
        ok: result.valid,
        valid: result.valid,
        status: result.status,
        error: result.error,
        refreshed: result.refreshed,
      };
    },
    exportCodexAccounts: (connectionIds: string[]) =>
      request<
        Array<{
          auth_mode: "chatgpt";
          OPENAI_API_KEY: null;
          tokens: {
            id_token: string | null;
            access_token: string | null;
            refresh_token: string | null;
            account_id: string | null;
          };
          last_refresh: string | null;
        }>
      >("/api/providers/export/codex", {
        method: "POST",
        body: json({ connectionIds }),
      }),
    exportQoderPats: (connectionIds: string[]) =>
      request<string>("/api/providers/export/qoder", {
        method: "POST",
        body: json({ connectionIds }),
      }),
    exportCodebuddyIntlCliTokens: (connectionIds: string[]) =>
      request<string>("/api/providers/export/codebuddy-intl-cli", {
        method: "POST",
        body: json({ connectionIds }),
      }),
    exportApiKeys: (connectionIds: string[]) =>
      request<string>("/api/providers/export/api-keys", {
        method: "POST",
        body: json({ connectionIds }),
      }),
    exportAlimsApiKeys: () =>
      request<string>("/api/providers/export/alims-api-keys", {
        method: "POST",
      }),
    grokCliDamaged: {
      list: () =>
        request<{ ids: string[] }>("/api/providers/grok-cli/damaged", {
          cache: "no-store",
        }),
      removeAll: () =>
        request<{ deleted: string[]; failed: string[] }>(
          "/api/providers/grok-cli/delete-damaged",
          { method: "POST" },
        ),
    },
    grokCliProbe407: {
      create: (
        connectionIds: string[],
        model?: string,
        timeoutMs?: number,
        concurrency?: number,
      ) =>
        request<Probe407Job>("/api/providers/grok-cli/probe-407", {
          method: "POST",
          body: json({ connectionIds, model, timeoutMs, concurrency }),
        }),
      get: (jobId: string) =>
        request<Probe407Job>(
          `/api/providers/grok-cli/probe-407/${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        ),
    },
    validate: (input: Record<string, unknown>) =>
      request<{ valid: boolean; error?: string | null }>(
        "/api/providers/validate",
        { method: "POST", body: json(input) },
      ),
    client: (params: {
      page?: number;
      pageSize?: number;
      accountStatus?: string;
      sort?: string;
      provider?: string;
    }) =>
      request<Record<string, unknown>>(
        `/api/providers/client?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, value]) => value !== undefined && value !== "")
              .map(([key, value]) => [key, String(value)]),
          ),
        )}`,
        { cache: "no-store" },
      ),
    testBatch: (input: Record<string, unknown>) =>
      request<Record<string, unknown>>("/api/providers/test-batch", {
        method: "POST",
        body: json(input),
      }),
    createTestJob: (input: { providerId: string; delayMs?: number }) =>
      request<ConnectionTestJob>("/api/providers/test-jobs", {
        method: "POST",
        body: json(input),
      }),
    latestTestJob: (providerId: string) =>
      request<ConnectionTestJob>(
        `/api/providers/test-jobs?${new URLSearchParams({ providerId })}`,
        { cache: "no-store" },
      ),
    getTestJob: (id: string) =>
      request<ConnectionTestJob>(
        `/api/providers/test-jobs/${encodeURIComponent(id)}`,
        { cache: "no-store" },
      ),
    cancelTestJob: (id: string) =>
      request<ConnectionTestJob>(
        `/api/providers/test-jobs/${encodeURIComponent(id)}/cancel`,
        { method: "POST" },
      ),
    suggestedModels: (url: string, type = "chat") =>
      request<{ data: Array<Record<string, unknown>> }>(
        `/api/providers/suggested-models?${new URLSearchParams({ url, type })}`,
        { cache: "no-store" },
      ),
    testModels: (id: string) =>
      request<{
        provider: string;
        connectionId: string;
        results: ProviderModelTestResult[];
      }>(`/api/providers/${encodeURIComponent(id)}/test-models`, {
        method: "POST",
      }),
    exportGrokCli: () =>
      request<Record<string, unknown>>("/api/oauth/grok-cli/export", {
        cache: "no-store",
      }),
    alimsModelAvailability: () =>
      request<{
        provider: string;
        totalAccounts: number;
        models: Array<{
          id: string;
          name: string;
          total: number;
          exhausted: number;
          available: number;
        }>;
      }>("/api/providers/alims-intl/model-availability", { cache: "no-store" }),
    resetAlimsModelAvailability: (model?: string) =>
      request<{ ok: true; reset: number; model: string | null }>(
        "/api/providers/alims-intl/model-availability/reset",
        { method: "POST", body: json({ model }) },
      ),
  },
  nodes: {
    list: async () =>
      envelope<ProviderNode[]>(
        await request<Record<string, unknown>>("/api/provider-nodes", {
          cache: "no-store",
        }),
        "nodes",
      ),
    create: async (input: Record<string, unknown>) =>
      envelope<ProviderNode>(
        await request<Record<string, unknown>>("/api/provider-nodes", {
          method: "POST",
          body: json(input),
        }),
        "node",
      ),
    update: (id: string, input: Record<string, unknown>) =>
      request<ProviderNode>(`/api/provider-nodes/${id}`, {
        method: "PUT",
        body: json(input),
      }),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/provider-nodes/${id}`, { method: "DELETE" }),
    validate: (baseUrl: string) =>
      request<{ ok: boolean; status?: number; error?: string }>(
        "/api/provider-nodes/validate",
        { method: "POST", body: json({ baseUrl }) },
      ),
  },
  proxies: {
    list: async () =>
      envelope<ProxyPool[]>(
        await request<Record<string, unknown>>("/api/proxy-pools", {
          cache: "no-store",
        }),
        "proxyPools",
      ),
    create: async (input: Record<string, unknown>) =>
      envelope<ProxyPool>(
        await request<Record<string, unknown>>("/api/proxy-pools", {
          method: "POST",
          body: json(input),
        }),
        "proxyPool",
      ),
    update: (id: string, input: Record<string, unknown>) =>
      request<ProxyPool>(`/api/proxy-pools/${id}`, {
        method: "PUT",
        body: json(input),
      }),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/proxy-pools/${id}`, { method: "DELETE" }),
    test: (id: string) =>
      request<{
        ok: boolean;
        status?: number;
        statusText?: string | null;
        error?: string | null;
        elapsedMs: number;
        testedAt: string;
      }>(`/api/proxy-pools/${id}/test`, { method: "POST" }),
  },
  models: {
    list: async (kind = "chat") => {
      const payload = await request<Record<string, unknown>>(
        kind === "chat" ? "/api/models" : `/api/models/${kind}`,
        { cache: "no-store" },
      );
      return "models" in payload
        ? {
            object: "list" as const,
            data: envelope<ModelItem[]>(payload, "models"),
          }
        : (payload as unknown as ModelListResponse);
    },
    search: async (
      query: string,
      opts?: { provider?: string; kind?: string; limit?: number },
    ) => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (opts?.provider) params.set("provider", opts.provider);
      if (opts?.kind) params.set("kind", opts.kind);
      if (opts?.limit) params.set("limit", String(opts.limit));
      const payload = await request<Record<string, unknown>>(
        `/api/models/search?${params.toString()}`,
        { cache: "no-store" },
      );
      return envelope<ModelItem[]>(payload, "models");
    },
    aliases: async () =>
      envelope<Record<string, string>>(
        await request<Record<string, unknown>>("/api/models/alias", {
          cache: "no-store",
        }),
        "aliases",
      ),
    saveAlias: (alias: string, targetModel: string) =>
      request<Record<string, string>>("/api/models/alias", {
        method: "PUT",
        body: json({ alias, targetModel }),
      }),
    deleteAlias: (alias: string) =>
      request<{ ok: true }>(
        `/api/models/alias?alias=${encodeURIComponent(alias)}`,
        { method: "DELETE" },
      ),
    custom: async () =>
      envelope<ModelItem[]>(
        await request<Record<string, unknown>>("/api/models/custom", {
          cache: "no-store",
        }),
        "models",
      ),
    saveCustom: async (input: Record<string, unknown>) => {
      const payload = await request<{ added: ModelItem }>(
        "/api/models/custom",
        {
          method: "POST",
          body: json({
            ...input,
            providerAlias: input.providerAlias || input.provider,
            id: input.id || input.model,
            type: input.type || input.kind,
          }),
        },
      );
      return payload.added;
    },
    disabled: async (providerAlias: string) =>
      envelope<string[]>(
        await request<Record<string, unknown>>(
          `/api/models/disabled?providerAlias=${encodeURIComponent(providerAlias)}`,
          { cache: "no-store" },
        ),
        "ids",
      ).map((id) => ({ providerAlias, id })),
    disable: (providerAlias: string, ids: string[]) =>
      request<Record<string, unknown>>("/api/models/disabled", {
        method: "POST",
        body: json({ providerAlias, ids }),
      }),
    enable: (providerAlias: string, id?: string) =>
      request<{ ok: true }>(
        `/api/models/disabled?providerAlias=${encodeURIComponent(providerAlias)}${id ? `&id=${encodeURIComponent(id)}` : ""}`,
        { method: "DELETE" },
      ),
    removeCustom: (id: string, providerAlias?: string) =>
      request<{ ok: true }>(
        `/api/models/custom?${new URLSearchParams({ id, ...(providerAlias ? { providerAlias } : {}) })}`,
        { method: "DELETE" },
      ),
    test: (model: string, kind = "llm") =>
      request<{ ok: boolean; error?: string }>("/api/models/test", {
        method: "POST",
        body: json({ model, kind }),
      }),
    contextWindows: async (provider?: string) =>
      request<{ overrides: Record<string, number> }>(
        `/api/models/context-window${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`,
        { cache: "no-store" },
      ),
    saveContextWindow: (
      provider: string,
      model: string,
      contextWindow: number,
    ) =>
      request<Record<string, unknown>>("/api/models/context-window", {
        method: "PUT",
        body: json({ provider, model, contextWindow }),
      }),
    removeContextWindow: (provider: string, model: string) =>
      request<Record<string, unknown>>(
        `/api/models/context-window?${new URLSearchParams({ provider, model })}`,
        { method: "DELETE" },
      ),
    capabilityOverrides: async (provider?: string) =>
      request<{ overrides: Record<string, Record<string, boolean>> }>(
        `/api/models/capabilities${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`,
        { cache: "no-store" },
      ),
    saveCapabilities: (
      provider: string,
      model: string,
      capabilities: Record<string, boolean>,
    ) =>
      request<Record<string, unknown>>("/api/models/capabilities", {
        method: "PUT",
        body: json({ provider, model, capabilities }),
      }),
  },
  combos: {
    list: async () =>
      envelope<Combo[]>(
        await request<Record<string, unknown>>("/api/combos", {
          cache: "no-store",
        }),
        "combos",
      ),
    create: (input: Record<string, unknown>) =>
      request<Combo>("/api/combos", { method: "POST", body: json(input) }),
    get: (id: string) =>
      request<Combo>(`/api/combos/${id}`, { cache: "no-store" }),
    update: (id: string, input: Record<string, unknown>) =>
      request<Combo>(`/api/combos/${id}`, { method: "PUT", body: json(input) }),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/combos/${id}`, { method: "DELETE" }),
    consumers: (id: string, keyIds: string[]) =>
      request<{ updated: number }>(`/api/combos/${id}/consumers`, {
        method: "POST",
        body: json({ keyIds }),
      }),
  },
  visionAdapters: {
    list: async () =>
      envelope<import("@/types/api").VisionAdapter[]>(
        await request<Record<string, unknown>>("/api/vision-adapters", {
          cache: "no-store",
        }),
        "adapters",
      ),
    create: (input: Record<string, unknown>) =>
      request<import("@/types/api").VisionAdapter>("/api/vision-adapters", {
        method: "POST",
        body: json(input),
      }),
    update: (id: string, input: Record<string, unknown>) =>
      request<import("@/types/api").VisionAdapter>(
        `/api/vision-adapters/${id}`,
        {
          method: "PUT",
          body: json(input),
        },
      ),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/vision-adapters/${id}`, { method: "DELETE" }),
    setGlobal: (id: string) =>
      request<{ ok: true }>(`/api/vision-adapters/${id}/set-global`, {
        method: "POST",
      }),
    clearGlobal: () =>
      request<{ ok: true }>("/api/vision-adapters/clear-global", {
        method: "POST",
      }),
  },

  keys: {
    list: async () =>
      envelope<ApiKey[]>(
        await request<Record<string, unknown>>("/api/keys", {
          cache: "no-store",
        }),
        "keys",
      ),
    listPage: (
      params: {
        page?: number;
        pageSize?: number;
        search?: string;
        visibility?: "private" | "public" | "event";
      } = {},
    ) => {
      const query = new URLSearchParams(
        Object.entries(params)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)]),
      );
      return request<ApiKeysResponse>(`/api/keys?${query}`, {
        cache: "no-store",
      });
    },
    get: (id: string) =>
      request<{ key: ApiKey }>(`/api/keys/${encodeURIComponent(id)}`, {
        cache: "no-store",
      }),
    children: (
      id: string,
      params: { page?: number; pageSize?: number; search?: string } = {},
    ) => {
      const query = new URLSearchParams(
        Object.entries(params)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)]),
      );
      return request<ApiKeysResponse>(
        `/api/keys/${encodeURIComponent(id)}/children?${query}`,
        { cache: "no-store" },
      );
    },
    reveal: (id: string) =>
      request<{ key: string }>(`/api/keys/${encodeURIComponent(id)}/secret`, {
        cache: "no-store",
      }),
    create: (input: Record<string, unknown>) =>
      request<ApiKey & { key: string }>("/api/keys", {
        method: "POST",
        body: json(input),
      }),
    update: async (id: string, input: Record<string, unknown>) =>
      envelope<ApiKey>(
        await request<Record<string, unknown>>(`/api/keys/${id}`, {
          method: "PUT",
          body: json(input),
        }),
        "key",
      ),
    remove: (id: string) =>
      request<{ message?: string; ok?: true }>(`/api/keys/${id}`, {
        method: "DELETE",
      }),
    config: () =>
      request<{ prefix: string }>("/api/keys/config", { cache: "no-store" }),
    updateConfig: (prefix: string) =>
      request<{ prefix: string }>("/api/keys/config", {
        method: "PATCH",
        body: json({ prefix }),
      }),
  },
  usage: {
    summary: (period?: UsagePeriod) =>
      request<UsageSummary>(
        `/api/usage/stats${period ? `?${new URLSearchParams({ period })}` : ""}`,
        { cache: "no-store" },
      ),
    history: (limit = 100, cursor?: string | null) =>
      request<UsageHistoryPage>(
        `/api/usage/history?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`,
        { cache: "no-store" },
      ),
    requestDetails: async (
      input: {
        page?: number;
        pageSize?: number;
        provider?: string;
        model?: string;
        outcome?: string;
        search?: string;
        startDate?: string;
        endDate?: string;
      } = {},
    ) =>
      request<RequestDetailsResponse>(
        `/api/usage/request-details?${new URLSearchParams(
          Object.entries(input)
            .filter(([, value]) => value !== undefined && value !== "")
            .map(([key, value]) => [key, String(value)]),
        )}`,
        { cache: "no-store" },
      ),
    requestDetail: (id: string) =>
      request<UsageRecord>(
        `/api/usage/request-details/${encodeURIComponent(id)}`,
        { cache: "no-store" },
      ),
    dashboard: (period: UsagePeriod = "today") =>
      request<DashboardUsage>(`/api/usage/dashboard?period=${period}`, {
        cache: "no-store",
      }),
    chart: (period = "7d") =>
      request<Record<string, unknown>>(`/api/usage/chart?period=${period}`, {
        cache: "no-store",
      }),
    providerOptions: () =>
      request<{ providers: Array<{ id: string; name: string }> }>(
        "/api/usage/providers",
        { cache: "no-store" },
      ),
    overview: (period: UsagePeriod = "24h", models = 16) =>
      request<UsageOverview>(
        `/api/usage/overview?${new URLSearchParams({ period, models: String(models) })}`,
        { cache: "no-store" },
      ),
    trend: (by: UsageTrendBy, period: UsagePeriod = "7d", top = 5) =>
      request<UsageTrend>(
        `/api/usage/trend?${new URLSearchParams({ by, period, top: String(top) })}`,
        { cache: "no-store" },
      ),
    providers: (
      period: UsagePeriod = "all",
      page = 1,
      pageSize = 10,
      search = "",
      filters: UsageListFilters = {},
    ) =>
      request<UsageListResponse<UsageProviderRow>>(
        `/api/usage/by-provider?${listParams(period, page, pageSize, search, filters)}`,
        { cache: "no-store" },
      ),
    apiKeys: (
      period: UsagePeriod = "all",
      page = 1,
      pageSize = 10,
      search = "",
      filters: UsageListFilters = {},
    ) =>
      request<UsageListResponse<UsageKeyRow>>(
        `/api/usage/api-keys?${listParams(period, page, pageSize, search, filters)}`,
        { cache: "no-store" },
      ),
    providerDetail: (id: string, period: UsagePeriod = "all") =>
      request<Record<string, unknown>>(
        `/api/usage/by-provider/${encodeURIComponent(id)}?${new URLSearchParams({ period })}`,
        { cache: "no-store" },
      ),
    accountDetail: (id: string, period: UsagePeriod = "all") =>
      request<Record<string, unknown>>(
        `/api/usage/by-account/${encodeURIComponent(id)}?${new URLSearchParams({ period })}`,
        { cache: "no-store" },
      ),
    apiKeyDetail: (id: string, period: UsagePeriod = "all") =>
      request<Record<string, unknown>>(
        `/api/usage/api-keys/${encodeURIComponent(id)}?${new URLSearchParams({ period })}`,
        { cache: "no-store" },
      ),
    accounts: (
      period: UsagePeriod = "all",
      page = 1,
      pageSize = 10,
      search = "",
      filters: UsageListFilters = {},
    ) =>
      request<UsageListResponse<UsageEntityRow>>(
        `/api/usage/by-account?${listParams(period, page, pageSize, search, filters)}`,
        { cache: "no-store" },
      ),
    models: (
      period: UsagePeriod = "all",
      page = 1,
      pageSize = 10,
      search = "",
      filters: UsageListFilters = {},
    ) =>
      request<UsageListResponse<UsageEntityRow>>(
        `/api/usage/by-model?${listParams(period, page, pageSize, search, filters)}`,
        { cache: "no-store" },
      ),
    combos: (
      period: UsagePeriod = "all",
      page = 1,
      pageSize = 10,
      search = "",
      filters: UsageListFilters = {},
    ) =>
      request<UsageListResponse<UsageEntityRow>>(
        `/api/usage/by-combo?${listParams(period, page, pageSize, search, filters)}`,
        { cache: "no-store" },
      ),
    byConnection: (connectionId: string) =>
      request<Record<string, unknown>>(
        `/api/usage/${encodeURIComponent(connectionId)}`,
        { cache: "no-store" },
      ),
    batch: (connectionIds: string[]) =>
      request<{
        results: Record<
          string,
          | { ok: true; data: Record<string, unknown> }
          | { ok: false; error: string }
        >;
      }>(
        `/api/usage/batch?ids=${encodeURIComponent(connectionIds.join(","))}`,
        { cache: "no-store" },
      ),
    batchRefresh: (connectionIds: string[]) =>
      request<{
        results: Record<
          string,
          | { ok: true; data: Record<string, unknown> }
          | { ok: false; error: string }
        >;
      }>(
        `/api/usage/batch/refresh?ids=${encodeURIComponent(connectionIds.join(","))}`,
        { method: "POST" },
      ),
    // Refresh only connections whose snapshot is stale (missing, error, or
    // past due). Called on page mount so a visit surfaces current numbers
    // without forcing an upstream fetch for still-fresh connections.
    staleRefresh: (connectionIds: string[]) =>
      request<{
        results: Record<
          string,
          | { ok: true; data: Record<string, unknown> }
          | { ok: false; error: string }
        >;
      }>(
        `/api/usage/stale/refresh?ids=${encodeURIComponent(connectionIds.join(","))}`,
        { method: "POST" },
      ),
    refreshConnection: (connectionId: string) =>
      request<Record<string, unknown>>(
        `/api/usage/${encodeURIComponent(connectionId)}/refresh`,
        { method: "POST" },
      ),
    autoclawTasks: {
      get: (connectionId: string) =>
        request<{
          claims: Array<{
            id: string;
            name: string;
            claimed: boolean;
            rewardPoints: number;
          }>;
          tasks: Array<Record<string, unknown>>;
        }>(`/api/usage/autoclaw-tasks/${encodeURIComponent(connectionId)}`, {
          cache: "no-store",
        }),
      claim: (connectionId: string, claimId: string) =>
        request<Record<string, unknown>>(
          `/api/usage/autoclaw-tasks/${encodeURIComponent(connectionId)}/claim/${encodeURIComponent(claimId)}`,
          { method: "POST" },
        ),
    },
    codebuddyProbe: {
      get: (connectionId: string) =>
        request<{
          probe: {
            probed: boolean;
            day: string;
            error: string | null;
            checkin: {
              state:
                | "claimed"
                | "already_claimed"
                | "not_eligible"
                | "event_ended"
                | "unavailable"
                | "error";
              credit: number | null;
              streakDays: number | null;
              error: string | null;
            } | null;
            reported: boolean;
          };
          records: Array<Record<string, unknown>>;
        }>(`/api/usage/codebuddy-probe/${encodeURIComponent(connectionId)}`, {
          cache: "no-store",
        }),
      run: (connectionId: string) =>
        request<{
          ok: boolean;
          status: "completed" | "error";
          alreadyDone: boolean;
          error?: string;
          checkin?: {
            state:
              | "claimed"
              | "already_claimed"
              | "not_eligible"
              | "event_ended"
              | "unavailable"
              | "error";
            credit: number | null;
            streakDays: number | null;
            error: string | null;
          } | null;
          reported?: boolean;
        }>(
          `/api/usage/codebuddy-probe/${encodeURIComponent(connectionId)}/run`,
          { method: "POST" },
        ),
    },
    codebuddyInvite: {
      bind: (connectionId: string, inviteCode: string) =>
        request<{
          ok: boolean;
          connectionId: string;
          error?: string;
          code?: unknown;
          msg?: unknown;
        }>(
          `/api/usage/codebuddy-invite/${encodeURIComponent(connectionId)}/bind`,
          { method: "POST", body: json({ inviteCode }) },
        ),
      bindBulk: (connectionIds: string[], inviteCode: string) =>
        request<{
          success: number;
          failed: number;
          results: Array<{
            ok: boolean;
            connectionId: string;
            error?: string;
          }>;
        }>("/api/usage/codebuddy-invite/bind-bulk", {
          method: "POST",
          body: json({ connectionIds, inviteCode }),
        }),
      chain: (
        connectionId: string,
        inviteCode: string,
        proxyPoolId?: string | null,
      ) =>
        request<{
          ok: boolean;
          connectionId: string;
          step: string;
          error?: string;
          steps: Array<{ step: string; ok: boolean; error?: string | null }>;
        }>(
          `/api/usage/codebuddy-invite/${encodeURIComponent(connectionId)}/chain`,
          {
            method: "POST",
            body: json({
              inviteCode,
              ...(proxyPoolId === undefined ? {} : { proxyPoolId }),
            }),
          },
        ),
      chainBulk: (
        connectionIds: string[],
        inviteCode: string,
        proxyPoolId?: string | null,
      ) =>
        request<{
          success: number;
          failed: number;
          results: Array<{
            ok: boolean;
            connectionId: string;
            step: string;
            error?: string;
            steps: Array<{ step: string; ok: boolean; error?: string | null }>;
          }>;
        }>("/api/usage/codebuddy-invite/chain-bulk", {
          method: "POST",
          body: json({
            connectionIds,
            inviteCode,
            ...(proxyPoolId === undefined ? {} : { proxyPoolId }),
          }),
        }),
    },
    codebuddyReport: {
      task: (connectionId: string) =>
        request<{
          ok: boolean;
          connectionId: string;
          error?: string;
          status?: number;
        }>(
          `/api/usage/codebuddy-report/${encodeURIComponent(connectionId)}/task`,
          { method: "POST" },
        ),
    },
    inspirationCenter: {
      list: (connectionId: string, language = "id") =>
        request<{
          items: Array<{
            inspiration_id: string;
            title: string;
            reward_points: number;
            completed: boolean;
            done: boolean;
          }>;
          language: string;
        }>(
          `/api/usage/inspiration-center/${encodeURIComponent(connectionId)}?${new URLSearchParams({ language })}`,
          { cache: "no-store" },
        ),
      claim: (connectionId: string, inspirationId: string, language = "id") =>
        request<Record<string, unknown>>(
          `/api/usage/inspiration-center/${encodeURIComponent(connectionId)}/claim`,
          {
            method: "POST",
            body: JSON.stringify({ inspiration_id: inspirationId, language }),
          },
        ),
      claimAll: (connectionId: string, language = "id") =>
        request<Record<string, unknown>>(
          `/api/usage/inspiration-center/${encodeURIComponent(connectionId)}/claim-all`,
          {
            method: "POST",
            body: JSON.stringify({ language }),
          },
        ),
    },
    codexResetCredits: {
      get: (connectionId: string) =>
        request<Record<string, unknown>>(
          `/api/usage/${encodeURIComponent(connectionId)}/codex-reset-credits`,
          { cache: "no-store" },
        ),
      post: (connectionId: string) =>
        request<Record<string, unknown>>(
          `/api/usage/${encodeURIComponent(connectionId)}/codex-reset-credits`,
          { method: "POST" },
        ),
    },
    clearCooldown: (connectionId: string) =>
      request<{ cleared: boolean }>(
        `/api/usage/${encodeURIComponent(connectionId)}/clear-cooldown`,
        { method: "POST" },
      ),
  },
  quota: {
    get: () => request<QuotaResponse>("/api/quota", { cache: "no-store" }),
    connection: (id: string) =>
      request<{ account: import("@/types/api").QuotaAccount }>(
        `/api/quota/connections/${encodeURIComponent(id)}`,
        { cache: "no-store" },
      ),
    refresh: (id: string) =>
      request<{ account: import("@/types/api").QuotaAccount }>(
        `/api/quota/connections/${encodeURIComponent(id)}/refresh`,
        { method: "POST" },
      ),
  },
  freeTracker: {
    get: () =>
      request<FreeTrackerResponse>("/api/free-tracker", { cache: "no-store" }),
    setVisibility: (sourceId: string, publicVisible: boolean) =>
      request<Record<string, unknown>>("/api/free-tracker", {
        method: "PATCH",
        body: json({ sourceId, publicVisible }),
      }),
  },
  queueJobs: {
    list: () =>
      request<QueueJobsResponse>("/api/queue-jobs", { cache: "no-store" }),
    remove: (jobId: string) =>
      request<{ ok: boolean; jobId: string }>(
        `/api/queue-jobs/${encodeURIComponent(jobId)}`,
        { method: "DELETE" },
      ),
    clearAll: () =>
      request<{ ok: boolean; removed: number }>("/api/queue-jobs", {
        method: "DELETE",
      }),
  },
  connect: {
    info: () =>
      request<{
        basePath: string;
        keys: Array<Record<string, unknown>>;
        combos: Array<Record<string, unknown>>;
      }>("/api/connect", { cache: "no-store" }),
    usage: () =>
      request<{ models: Array<Record<string, unknown>>; updatedAt?: string }>(
        "/api/connect/usage",
        { cache: "no-store" },
      ),
  },
  publicStats: {
    get: (apikey: string) =>
      request<PublicKeyStats>(
        `/api/public/stats?apikey=${encodeURIComponent(apikey)}`,
        { cache: "no-store" },
      ),
  },
  publicEvents: {
    get: (id: string) =>
      request<PublicEvent>(`/api/public/events/${encodeURIComponent(id)}`, {
        cache: "no-store",
      }),
    join: (id: string, name: string) =>
      request<{ key: string; name: string }>(
        `/api/public/events/${encodeURIComponent(id)}/keys`,
        { method: "POST", body: json({ name }) },
      ),
  },
  pricing: {
    get: () => request<PricingMap>("/api/pricing", { cache: "no-store" }),
    update: (pricing: PricingMap) =>
      request<PricingMap>("/api/pricing", {
        method: "PATCH",
        body: json(pricing),
      }),
    reset: (provider?: string, model?: string) =>
      request<PricingMap>(
        `/api/pricing${provider || model ? `?${new URLSearchParams({ ...(provider ? { provider } : {}), ...(model ? { model } : {}) })}` : ""}`,
        { method: "DELETE" },
      ),
  },
  host: {
    headroom: {
      status: () =>
        request<Record<string, unknown>>("/api/headroom/status", {
          cache: "no-store",
        }),
      extras: (log = false) =>
        request<Record<string, unknown>>(
          `/api/headroom/extras${log ? "?log=1" : ""}`,
          { cache: "no-store" },
        ),
      start: () =>
        request<Record<string, unknown>>("/api/headroom/start", {
          method: "POST",
        }),
      stop: () =>
        request<Record<string, unknown>>("/api/headroom/stop", {
          method: "POST",
        }),
      restart: () =>
        request<Record<string, unknown>>("/api/headroom/restart", {
          method: "POST",
        }),
      installExtras: (extras: string[]) =>
        request<Record<string, unknown>>("/api/headroom/extras", {
          method: "POST",
          body: json({ extras }),
        }),
      removeExtras: (extras: string[]) =>
        request<Record<string, unknown>>("/api/headroom/extras", {
          method: "DELETE",
          body: json({ extras }),
        }),
    },
    pxpipe: {
      status: () =>
        request<Record<string, unknown>>("/api/pxpipe/status", {
          cache: "no-store",
        }),
      start: () =>
        request<Record<string, unknown>>("/api/pxpipe/start", {
          method: "POST",
        }),
      stop: () =>
        request<Record<string, unknown>>("/api/pxpipe/stop", {
          method: "POST",
        }),
      restart: () =>
        request<Record<string, unknown>>("/api/pxpipe/restart", {
          method: "POST",
        }),
      install: () =>
        request<Record<string, unknown>>("/api/pxpipe/install", {
          method: "POST",
        }),
      health: () =>
        request<Record<string, unknown>>("/api/pxpipe/health", {
          method: "POST",
        }),
      stats: () =>
        request<Record<string, unknown>>("/api/pxpipe/stats", {
          cache: "no-store",
        }),
      logs: () =>
        request<Record<string, unknown>>("/api/pxpipe/logs", {
          cache: "no-store",
        }),
    },
    tunnels: {
      status: () =>
        request<Record<string, unknown>>("/api/tunnel/status", {
          cache: "no-store",
        }),
      enable: (input: Record<string, unknown> = {}) =>
        request<Record<string, unknown>>("/api/tunnel/enable", {
          method: "POST",
          body: json(input),
        }),
      disable: () =>
        request<Record<string, unknown>>("/api/tunnel/disable", {
          method: "POST",
        }),
      tailscaleCheck: () =>
        request<Record<string, unknown>>("/api/tunnel/tailscale-check", {
          method: "POST",
        }),
      tailscaleEnable: (input: Record<string, unknown> = {}) =>
        request<Record<string, unknown>>("/api/tunnel/tailscale-enable", {
          method: "POST",
          body: json(input),
        }),
      tailscaleDisable: () =>
        request<Record<string, unknown>>("/api/tunnel/tailscale-disable", {
          method: "POST",
        }),
    },
    mitm: {
      status: () =>
        request<Record<string, unknown>>("/api/cli-tools/antigravity-mitm", {
          cache: "no-store",
        }),
      update: (input: Record<string, unknown>) =>
        request<Record<string, unknown>>("/api/cli-tools/antigravity-mitm", {
          method: "PATCH",
          body: json(input),
        }),
      start: (input: Record<string, unknown>) =>
        request<Record<string, unknown>>("/api/cli-tools/antigravity-mitm", {
          method: "POST",
          body: json(input),
        }),
      stop: (input: Record<string, unknown> = {}) =>
        request<Record<string, unknown>>("/api/cli-tools/antigravity-mitm", {
          method: "DELETE",
          body: json(input),
        }),
      aliases: (tool?: string) =>
        request<Record<string, unknown>>(
          `/api/cli-tools/antigravity-mitm/alias${tool ? `?tool=${encodeURIComponent(tool)}` : ""}`,
          { cache: "no-store" },
        ),
      saveAliases: (tool: string, mappings: Record<string, string>) =>
        request<Record<string, unknown>>(
          "/api/cli-tools/antigravity-mitm/alias",
          { method: "PUT", body: json({ tool, mappings }) },
        ),
    },
  },
  cliTools: {
    catalog: () =>
      request<CliToolCatalogResponse>("/api/cli-tools/catalog", {
        cache: "no-store",
      }),
    allStatuses: () =>
      request<Record<string, Record<string, unknown>>>(
        "/api/cli-tools/all-statuses",
        { cache: "no-store" },
      ),
    status: (tool: string) =>
      request<Record<string, unknown>>(`/api/cli-tools/${tool}-settings`, {
        cache: "no-store",
      }),
    generate: (tool: string, input: Record<string, unknown>) =>
      request<Record<string, unknown>>(`/api/cli-tools/${tool}-settings`, {
        method: "POST",
        body: json(input),
      }),
    reset: (tool: string) =>
      request<Record<string, unknown>>(`/api/cli-tools/${tool}-settings`, {
        method: "DELETE",
      }),
    mcpRegistry: () =>
      request<Record<string, unknown>>("/api/cli-tools/cowork-mcp-registry", {
        cache: "no-store",
      }),
    mcpProbe: (url: string) =>
      request<Record<string, unknown>>("/api/cli-tools/cowork-mcp-tools", {
        method: "POST",
        body: json({ url }),
      }),
  },
  dashboardChat: {
    models: () =>
      request<ModelListResponse>("/api/dashboard/chat/models", {
        cache: "no-store",
      }),
    accounts: (model: string) =>
      request<{
        model: string;
        supportsSelection: boolean;
        accounts: Array<{
          id: string;
          label: string;
          email?: string | null;
          isActive?: boolean;
        }>;
      }>(`/api/dashboard/chat/accounts?${new URLSearchParams({ model })}`, {
        cache: "no-store",
      }),
    completions: (
      format: "responses" | "messages",
      body: Record<string, unknown>,
      signal?: AbortSignal,
      connectionId?: string,
    ) =>
      gatewayPost(
        `/api/dashboard/chat/completions?${new URLSearchParams({ format })}`,
        body,
        signal,
        {
          ...(format === "messages"
            ? { "anthropic-version": "2023-06-01" }
            : {}),
          ...(connectionId ? { "x-connection-id": connectionId } : {}),
        },
      ),
  },
  translator: {
    translate: (step: 1 | 2 | 3, body: Record<string, unknown>) =>
      request<{ success: true; result: Record<string, unknown> }>(
        "/api/translator/translate",
        { method: "POST", body: json({ step, body }) },
      ),
    save: (file: string, content: string) =>
      request<{ success: true }>("/api/translator/save", {
        method: "POST",
        body: json({ file, content }),
      }),
    load: (file: string) =>
      request<{ success: true; content: string }>(
        `/api/translator/load?file=${encodeURIComponent(file)}`,
        { cache: "no-store" },
      ),
    send: (provider: string, model: string, body: Record<string, unknown>) =>
      gatewayPost("/api/translator/send", { provider, model, body }),
    logs: () =>
      request<ConsoleLogsResponse>("/api/translator/console-logs", {
        cache: "no-store",
      }),
    clearLogs: () =>
      request<{ success: boolean }>("/api/translator/console-logs", {
        method: "DELETE",
      }),
  },
  gateway: {
    models: (kind = "chat") =>
      request<ModelListResponse>(
        kind === "chat"
          ? "/v1/models"
          : `/v1/models/${encodeURIComponent(kind)}`,
        { cache: "no-store" },
      ),
    post: gatewayPost,
  },
  scheduler: {
    list: async () => {
      const payload = await request<Record<string, unknown>>("/api/scheduler", {
        cache: "no-store",
      });
      return (payload as { schedulers?: any[] }).schedulers || [];
    },
    toggle: (id: string, enabled: boolean) =>
      request<{ success: boolean; enabled: boolean }>(
        `/api/scheduler/${id}/toggle`,
        {
          method: "POST",
          body: json({ enabled }),
        },
      ),
  },
};
