import type { Runtime } from "../../runtime";
import type { ApiKeyRecord, ProviderConnection } from "../../db/repositories";
import { getProviderRegistryEntry, resolveProviderId } from "../providers/providerCatalog";
// Pure v1 utilities: identical error envelopes and registry-driven model parsing.
import { errorResponse, unavailableResponse } from "../common/error.ts";
import { parseModel, resolveModelAliasFromMap } from "../providers/model.ts";
import { fallbackState, errorMessage, unavailableUntil } from "../chat/fallback";
import { handleComboChat } from "../chat/combo.js";
import { isModelLockActive } from "../chat/accountFallback.js";
import { markAccountUnavailable, clearAccountError, connectionsWithFreeSlots, type ConnectionSelection } from "../chat/credentials";
import { attemptFailed, connectionsBusyResponse, fallbackAttempts, nextConnectionAttempt } from "../chat/connectionAttempt";
import { releaseWhenDone } from "../chat/admission";
import { isGrokCliFamilyExhausted } from "../providers/grokCliQuotaFamily.js";
import { credentialToken, providerTokenRefresh, refreshAfterAuthFailure } from "../providers/refreshCoordinator";

export { errorResponse, unavailableResponse };

export interface MediaModelInfo {
  provider: string | null;
  model: string;
  isCombo: boolean;
  comboModels?: string[];
}

export function comboModelList(combo: Record<string, unknown>): string[] {
  try {
    const models = JSON.parse(String(combo.models || "[]"));
    return Array.isArray(models) ? models.filter((model) => typeof model === "string" && model) : [];
  } catch {
    return [];
  }
}

// v1 resolution order: user alias → combo → registry alias + prefix inference →
// provider-node prefix. Media models are always "provider/model" or a bare
// provider (search/fetch use the provider as the model).
export function mediaModelInfo(runtime: Runtime, modelStr: string): MediaModelInfo {
  const aliases = runtime.repos.aliases.list();
  let current = String(modelStr || "");
  for (let hops = 0; hops < 10 && aliases[current]; hops += 1) current = aliases[current];

  const combo = runtime.repos.combos.get(current);
  if (combo) return { provider: null, model: current, isCombo: true, comboModels: comboModelList(combo) };

  const parsed = parseModel(current) as { provider?: string; model?: string; isAlias?: boolean; providerAlias?: string };
  if (!parsed.isAlias && parsed.provider) {
    // Root reserves every built-in provider ID and alias so a user-defined
    // compatible-node prefix cannot shadow a provider such as openai or cf.
    const providerAlias = String(parsed.providerAlias || parsed.provider);
    const builtIn = getProviderRegistryEntry(resolveProviderId(providerAlias));
    const node = builtIn ? null : runtime.repos.nodes.list().find((item) => item.prefix === providerAlias);
    const provider = node ? String(node.id) : String(parsed.provider);
    return { provider, model: String(parsed.model), isCombo: false };
  }

  const resolved = resolveModelAliasFromMap(current, aliases) as { provider?: string; model?: string } | null;
  if (resolved?.provider) return { provider: String(resolved.provider), model: String(resolved.model), isCombo: false };
  if (current === "grok-build") return { provider: "grok-cli", model: "grok-build", isCombo: false };

  const qoderModels = (getProviderRegistryEntry("qoder")?.models || []) as Array<{ id?: string }>;
  if (qoderModels.some((entry) => String(entry.id || "").toLowerCase() === current.toLowerCase())) {
    return { provider: "qoder", model: current, isCombo: false };
  }
  const lower = current.toLowerCase();
  const inferred = MODEL_PREFIX_PROVIDERS.find(([pattern]) => pattern.test(lower))?.[1] || "openai";
  return { provider: inferred, model: current, isCombo: false };
}

// v1 prefix inference for bare model ids, shared with the generic gateway.
export function inferProviderPrefix(model: string): string {
  const lower = String(model || "").toLowerCase();
  return MODEL_PREFIX_PROVIDERS.find(([pattern]) => pattern.test(lower))?.[1] || "openai";
}

const MODEL_PREFIX_PROVIDERS: Array<[RegExp, string]> = [
  [/^claude-/, "anthropic"],
  [/^gpt-/, "openai"],
  [/^o[134]/, "openai"],
];

// Map a v2 connection onto the credential shape v1 media adapters read:
// flat token fields plus providerSpecificData for per-provider extras.
export function v1Credentials(connection: ProviderConnection): Record<string, any> {
  return {
    ...connection.data,
    providerSpecificData: connection.data,
    baseUrl: connection.baseUrl ?? connection.data.baseUrl ?? null,
    connectionId: connection.id,
    connectionName: connection.name || connection.email || connection.id,
  };
}

// After a 401/403: the media Credentials with the token fields of the stored
// Connection after a refresh (or a refresh another request already ran), or
// null when no new token is available.
export async function refreshMediaCredentials(runtime: Runtime, connectionId: string, credentials: Record<string, any>): Promise<Record<string, any> | null> {
  const stored = await refreshAfterAuthFailure(runtime, connectionId, credentialToken(credentials), { refresh: providerTokenRefresh });
  return stored ? { ...credentials, accessToken: stored.accessToken, refreshToken: stored.refreshToken || credentials.refreshToken } : null;
}

const FALLBACK_ELIGIBLE = new Set([401, 403, 408, 429, 500, 502, 503, 504]);

export interface CoreResult {
  success: boolean;
  response: Response;
  status?: number;
  error?: string;
  resetsAtMs?: number | null;
  disableAccount?: boolean;
}

// The uniform account-fallback loop v1 media handlers run: try each available
// connection (model locks and grok-cli quota markers skip accounts); failures
// go through the v1 mark semantics (checkFallbackError classification,
// per-model locks, grok-cli credits probe, disableAccount) and successes
// through the v1 sparse clear. Each attempt holds a Connection slot; a
// successful body keeps it until the body ends. The Fallback cap applies.
export async function mediaFallbackLoop(
  runtime: Runtime,
  provider: string,
  model: string | null,
  run: (connection: ProviderConnection, credentials: Record<string, any>) => Promise<CoreResult>,
): Promise<Response> {
  const settings = runtime.repos.settings.get() as Record<string, any>;
  const eligible = (connection: ProviderConnection) => {
    if (model && isModelLockActive({ ...connection.data } as Record<string, unknown>, model)) return false;
    if (isGrokCliFamilyExhausted(connection.data as Record<string, unknown>, model)) return false;
    return true;
  };
  const select = (excludeIds: Set<string>): ConnectionSelection => {
    const pool = runtime.repos.providers.select(provider).filter((connection) => !excludeIds.has(connection.id) && eligible(connection));
    const free = connectionsWithFreeSlots(runtime, settings, provider, pool);
    if (free.saturated) return { selected: null, remaining: 0, saturated: true };
    const connection = free.connections[0];
    return connection
      ? { selected: { connection, credentials: v1Credentials(connection), synthetic: false }, remaining: free.connections.length - 1 }
      : { selected: null, remaining: 0 };
  };
  const attempts = fallbackAttempts(settings);

  while (true) {
    const step = nextConnectionAttempt(runtime, attempts, select, { provider, model: model || "", apiKey: null });
    if (step.kind === "saturated") return connectionsBusyResponse("openai");
    if (step.kind !== "attempt") {
      if (attempts.lastError) return errorResponse(attempts.lastError.status, attempts.lastError.message);
      return errorResponse(400, `No credentials for provider: ${provider}`);
    }
    const { connection, credentials } = step.selected;
    const release = () => step.slot?.release();
    let result: CoreResult;
    try {
      result = await run(connection, credentials);
    } catch (error) {
      release();
      throw error;
    }
    if (result.success) {
      clearAccountError(runtime, connection, model);
      return releaseWhenDone(result.response, release);
    }
    release();
    const status = result.status || 502;
    const message = result.error || `HTTP ${result.status}`;
    const shouldFallback = await markAccountUnavailable(runtime, connection, status, message, provider, model, result.resetsAtMs ?? null, result.disableAccount === true);
    if (!shouldFallback) return result.response;
    attemptFailed(attempts, connection.id, status, result.error || "All accounts unavailable");
  }
}

// v1 media handlers expand combos through handleComboChat with the configured
// combo strategy (fallback / round-robin / sticky), not a plain sequence.
export async function mediaComboDispatch(
  runtime: Runtime,
  comboName: string,
  comboModels: string[],
  body: Record<string, unknown>,
  runSingle: (body: Record<string, unknown>, model: string) => Promise<Response>,
): Promise<Response> {
  const settings = runtime.repos.settings.get() as Record<string, any>;
  const strategyConfig = ((settings.comboStrategies || {})[comboName] || {}) as Record<string, any>;
  const comboStrategy = strategyConfig.fallbackStrategy || settings.comboStrategy || "fallback";
  const comboStickyLimit = Number(settings.comboStickyRoundRobinLimit ?? 1) || 1;
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  return handleComboChat({
    body,
    models: comboModels,
    handleSingleModel: (singleBody: Record<string, unknown>, model: string) => runSingle(singleBody, model),
    log,
    comboName,
    comboStrategy,
    comboStickyLimit,
  }) as unknown as Promise<Response>;
}

// API-key model access + lifetime limit checks, shared with the chat path.
export function enforceApiKeyAccess(apiKey: ApiKeyRecord | null | undefined, model: string, options: { isCombo?: boolean } = {} as any): Response | null {
  if (!apiKey) return null;
  // v1 semantics: combo-name requests follow the combo access gate, direct
  // model requests follow the model access gate. An empty whitelist blocks
  // everything (see the key editor copy in EndpointView).
  const isCombo = options.isCombo === true;
  const mode = isCombo ? apiKey.comboAccessMode || "blacklist" : apiKey.modelAccessMode || "whitelist";
  const list = isCombo ? apiKey.comboAccessList : apiKey.modelAccessList;
  const allowed = mode === "whitelist" ? list.includes(model) : !list.includes(model);
  if (!allowed) {
    return Response.json({ error: { message: isCombo ? "Combo is not permitted for this API key" : "Model is not permitted for this API key", type: "permission_error" } }, { status: 403 });
  }
  if (apiKey.limitMode !== "none" && apiKey.limitValue != null && apiKey.usageRequests >= apiKey.limitValue) {
    return Response.json({ error: { message: "API key usage limit exceeded", type: "permission_error" } }, { status: 429 });
  }
  return null;
}

export function incrementKeyUsage(runtime: Runtime, apiKey: ApiKeyRecord | null | undefined, tokens = 0): void {
  if (apiKey) runtime.repos.keys.incrementUsage(apiKey.id, tokens);
}

export function mediaUsage(runtime: Runtime, input: { provider: string; model?: string | null; connectionId?: string | null; apiKey?: ApiKeyRecord | null; endpoint: string; clientIp?: string; promptTokens?: number; completionTokens?: number }): void {
  runtime.repos.usage.record({
    provider: input.provider,
    model: input.model || null,
    connectionId: input.connectionId || null,
    apiKey: input.apiKey?.key || null,
    endpoint: input.endpoint,
    clientIp: input.clientIp || null,
    promptTokens: input.promptTokens || 0,
    completionTokens: input.completionTokens || 0,
  });
  incrementKeyUsage(runtime, input.apiKey, Number(input.promptTokens || 0) + Number(input.completionTokens || 0));
}

export function providerSupports(runtime: Runtime, providerInput: string): { id: string; entry: Record<string, any> } | null {
  const id = resolveProviderId(providerInput);
  const entry = getProviderRegistryEntry(id);
  return entry ? { id, entry } : null;
}

export { errorMessage };
