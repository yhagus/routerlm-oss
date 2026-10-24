import type { ProviderConnection } from "../../db/repositories";
import type { Runtime } from "../../runtime";
import { getProviderMetadata, getProviderModelDiscoveryUrl } from "./providerCatalog";
import { resolveQoderModels } from "./discovery/qoderModels.ts";
import { resolveGrokCliModels } from "./discovery/grokCliModels.ts";
import { resolveConnectionProxyConfig, resolveV1ProviderSpecificData } from "../chat/credentials";
import { refreshAfterAuthFailure, type RefreshFunction } from "./refreshCoordinator";
import { providerSpecificPatch } from "./providerSpecificPatch";
import { isPlainObject } from "../common/objects";

export interface ProviderProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
  url?: string;
  refreshed?: boolean;
  models?: Array<Record<string, unknown>>;
}

function credentials(connection: ProviderConnection): Record<string, unknown> {
  return { ...connection.data, ...connection.credentials };
}

function patchProviderSpecificData(runtime: Runtime, connectionId: string, extras: Record<string, unknown>): void {
  runtime.repos.providers.patch(connectionId, { data: providerSpecificPatch(runtime.repos.providers.get(connectionId), extras) });
}

// A refresh during model discovery goes through the refresh coordinator, so
// it joins a refresh that a request already started.
function storedRefresh(runtime: Runtime, connection: ProviderConnection, refresh?: RefreshFunction) {
  return async (failed: Record<string, any>): Promise<{ accessToken: string; refreshToken?: string } | null> => {
    const stored = await refreshAfterAuthFailure(runtime, connection.id, failed?.accessToken ?? null, { refresh, log: console });
    return stored?.accessToken ? { accessToken: stored.accessToken, refreshToken: stored.refreshToken } : null;
  };
}

function token(connection: ProviderConnection): string | null {
  const auth = credentials(connection);
  for (const key of ["apiKey", "accessToken", "token", "cookie"]) {
    if (typeof auth[key] === "string" && auth[key]) return auth[key] as string;
  }
  return null;
}

function baseUrl(connection: ProviderConnection): string | null {
  const auth = credentials(connection);
  const value = connection.baseUrl || (typeof auth.baseUrl === "string" ? auth.baseUrl : null) || (typeof auth.resourceUrl === "string" ? auth.resourceUrl : null);
  return value?.trim().replace(/\/$/, "") || null;
}

function modelUrl(connection: ProviderConnection): string | null {
  const base = baseUrl(connection);
  if (!base) {
    // Registry providers without a connection-level baseUrl (GMI Cloud, etc.)
    // still expose a validateUrl (models endpoint) in the catalog.
    return getProviderModelDiscoveryUrl(connection.provider);
  }
  if (base.endsWith("/models")) return base;
  if (base.endsWith("/chat/completions") || base.endsWith("/messages")) return base.replace(/\/chat\/completions$|\/messages$/, "/models");
  if (base.endsWith("/v1")) return `${base}/models`;
  return `${base}/v1/models`;
}

function headersFor(connection: ProviderConnection): Headers {
  const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
  const value = token(connection);
  const metadata = getProviderMetadata(connection.provider);
  if (!value) return headers;
  if (connection.provider === "anthropic" || connection.apiType === "anthropic" || metadata?.category === "webCookie") headers.set("x-api-key", value);
  else if (connection.authType === "cookie") headers.set("cookie", value);
  else headers.set("authorization", `Bearer ${value}`);
  if (connection.provider === "anthropic" || connection.apiType === "anthropic") headers.set("anthropic-version", "2023-06-01");
  return headers;
}

function parseModels(payload: unknown): Array<Record<string, unknown>> {
  const body = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const values = Array.isArray(payload) ? payload : Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : Array.isArray(body.results) ? body.results : Array.isArray(body.tags) ? body.tags : [];
  return values.flatMap((item) => {
    const source = typeof item === "string" ? { id: item } : item as Record<string, unknown>;
    const id = source?.id || source?.model || source?.name;
    if (!id) return [];
    return [{ ...source, id: String(id), name: String(source.name || source.displayName || source.label || id) }];
  });
}

function staticModels(connection: ProviderConnection): Array<Record<string, unknown>> {
  return getProviderMetadata(connection.provider)?.models || [];
}

export async function discoverProviderModels(connection: ProviderConnection, runtime: Runtime): Promise<ProviderProbeResult> {
  const auth = credentials(connection) as Record<string, any>;
  const providerSpecificData = resolveV1ProviderSpecificData(auth);
  const dynamicResolvers: Record<string, () => Promise<any>> = {
    qoder: () => resolveQoderModels({ accessToken: auth.accessToken, refreshToken: auth.refreshToken, email: connection.email, providerSpecificData }, { forceRefresh: true }),
  };
  if (dynamicResolvers[connection.provider]) {
    try {
      const result = await dynamicResolvers[connection.provider]();
      const models = Array.isArray(result?.models) ? result.models : [];
      return { ok: true, status: 200, models: models.length ? models : staticModels(connection) };
    } catch (error: any) {
      return { ok: false, error: error instanceof Error ? error.message : "Dynamic model discovery failed", models: staticModels(connection) };
    }
  }
  if (connection.provider === "grok-cli") {
    try {
      const result = await resolveGrokCliModels({ ...auth, connectionId: connection.id, providerSpecificData }, {
        log: console,
        proxyOptions: resolveConnectionProxyConfig(runtime, providerSpecificData),
        refreshCredentials: storedRefresh(runtime, connection),
        // The refresh coordinator already stored the tokens. Store only the
        // discovered model catalog here.
        onCredentialsRefreshed: async (refreshed: Record<string, unknown>) => {
          if (!isPlainObject(refreshed.providerSpecificData)) return;
          patchProviderSpecificData(runtime, connection.id, refreshed.providerSpecificData);
        },
      });
      return { ok: true, status: 200, models: result.models.length ? result.models : staticModels(connection) };
    } catch (error: any) {
      return { ok: false, error: error instanceof Error ? error.message : "Grok CLI model discovery failed", models: staticModels(connection) };
    }
  }
  if (connection.provider === "zenmux") {
    const url = getProviderModelDiscoveryUrl("zenmux");
    const apiKey = token(connection);
    if (!url || !apiKey) return { ok: false, status: 401, error: "No ZenMux API key found", models: [] as any[]};
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return { ok: false, status: response.status, error: `Failed to fetch ZenMux models: ${response.status}`, url, models: [] as any[]};
      const models = parseModels(await response.json()).filter((model) =>
        Array.isArray(model.output_modalities) && model.output_modalities.includes("text")
      );
      return { ok: true, status: response.status, url, models };
    } catch (error: any) {
      return { ok: false, error: error instanceof Error ? error.message : "ZenMux model discovery failed", url, models: [] as any[]};
    }
  }
  if (connection.provider === "orcarouter") {
    const url = getProviderModelDiscoveryUrl("orcarouter");
    const apiKey = token(connection);
    if (!url || !apiKey) return { ok: false, status: 401, error: "No OrcaRouter API key found", models: staticModels(connection) };
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return { ok: false, status: response.status, error: `Failed to fetch OrcaRouter models: ${response.status}`, url, models: staticModels(connection) };
      // The catalog also lists embedding, image and video models. Keep the
      // ones that chat completions can serve.
      const models = parseModels(await response.json()).filter((model) =>
        Array.isArray(model.supported_endpoint_types) && model.supported_endpoint_types.includes("openai")
      );
      return { ok: true, status: response.status, url, models: models.length ? models : staticModels(connection) };
    } catch (error: any) {
      return { ok: false, error: error instanceof Error ? error.message : "OrcaRouter model discovery failed", url, models: staticModels(connection) };
    }
  }
  const url = modelUrl(connection);
  if (!url) return { ok: false, error: "Provider has no model discovery URL", models: staticModels(connection) };
  try {
    const response = await fetch(url, { method: "GET", headers: headersFor(connection), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { ok: false, status: response.status, error: `${response.status} ${await response.text()}`, url, models: staticModels(connection) };
    const models = parseModels(await response.json());
    return { ok: true, status: response.status, url, models: models.length ? models : staticModels(connection) };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : "Connection failed", url, models: staticModels(connection) };
  }
}
