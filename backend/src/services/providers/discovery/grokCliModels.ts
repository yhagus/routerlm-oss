import {
  GROK_CLI_AUTHENTICATE_RESPONSE,
  GROK_CLI_BASE_URL,
  GROK_CLI_CLIENT_MODE,
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_TOKEN_AUTH,
  GROK_CLI_USER_AGENT,
  GROK_CLI_VERSION,
} from "../config/grokCli.ts";
import { parseGrokCliModelsEnhanced } from "../config/grokCliModels.ts";
import { refreshProviderCredentials } from "../oauth/oauthCredentialManager.ts";
import { proxyAwareFetch } from "../../common/proxyFetch.ts";

const MODELS_URL = `${GROK_CLI_BASE_URL}/models`;
const modelCacheByConnection = new Map();
const MODEL_CACHE_MAX_CONNECTIONS = 100;

export function parseGrokCliModels(data: any) {
  return parseGrokCliModelsEnhanced(data);
}

function getPersistedModels(credentials: any) {
  const models = credentials?.providerSpecificData?.discoveredModels;
  return Array.isArray(models) && models.length ? models : [];
}

export function getCachedGrokCliModelInfo(connectionId: any, modelId: any) {
  if (!connectionId || !modelId) return null;
  return modelCacheByConnection.get(connectionId)?.get(modelId) || null;
}

function cacheModels(connectionId: any, models: any) {
  if (!connectionId) return;
  while (modelCacheByConnection.size >= MODEL_CACHE_MAX_CONNECTIONS && !modelCacheByConnection.has(connectionId)) {
    modelCacheByConnection.delete(modelCacheByConnection.keys().next().value);
  }
  modelCacheByConnection.set(connectionId, new Map(models.map((model: any) => [model.id, model])));
}

function buildHeaders(accessToken: any, providerSpecificData: any = {}) {
  const headers: Record<string, any> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": GROK_CLI_USER_AGENT,
    "X-XAI-Token-Auth": GROK_CLI_TOKEN_AUTH,
    "x-authenticateresponse": GROK_CLI_AUTHENTICATE_RESPONSE,
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
    "x-grok-client-mode": GROK_CLI_CLIENT_MODE,
  };
  const email = providerSpecificData?.email;
  const userId = providerSpecificData?.userId || providerSpecificData?.principalId;
  if (email) headers["x-email"] = email;
  if (userId) headers["x-userid"] = userId;
  return headers;
}

export async function resolveGrokCliModels(credentials: any, options: any = {}) {
  const {
    fetchFn = proxyAwareFetch,
    log = console,
    proxyOptions = null,
    onCredentialsRefreshed,
    // A stored Connection passes the refresh coordinator here.
    refreshCredentials = (current: any) => refreshProviderCredentials("grok-cli", current, log, proxyOptions),
  } = options;
  let accessToken = credentials?.accessToken;
  if (!accessToken) {
    const models = getPersistedModels(credentials);
    return { models, warning: models.length ? "Using persisted Grok CLI model catalog." : "Grok CLI access token is missing." };
  }

  const request = (token: any) => fetchFn(
    MODELS_URL,
    {
      method: "GET",
      headers: buildHeaders(token, credentials?.providerSpecificData),
    },
    proxyOptions,
  );

  try {
    let response = await request(accessToken);
    if (response.status === 401 && credentials?.refreshToken) {
      const refreshed = await refreshCredentials(credentials);
      if (refreshed?.accessToken) {
        accessToken = refreshed.accessToken;
        try {
          await onCredentialsRefreshed?.(refreshed);
        } catch (error: any) {
          log?.warn?.("Grok CLI credential persistence failed", error);
        }
        response = await request(accessToken);
      }
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const models = getPersistedModels(credentials);
      return {
        models,
        warning: `Grok CLI model discovery failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      };
    }

    const models = parseGrokCliModels(await response.json());
    cacheModels(credentials?.connectionId || credentials?.id, models);
    try {
      await onCredentialsRefreshed?.({
        providerSpecificData: {
          discoveredModels: models,
          discoveredModelsAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      log?.warn?.("Grok CLI model persistence failed", error);
    }
    if (models.length) return { models };
    const persisted = getPersistedModels(credentials);
    return persisted.length
      ? { models: persisted, warning: "Grok CLI returned no selectable models; using persisted catalog." }
      : { models: [] as any[], warning: "Grok CLI returned no selectable models." };
  } catch (error: any) {
    const models = getPersistedModels(credentials);
    return { models, warning: `Grok CLI model discovery failed: ${error.message}` };
  }
}
