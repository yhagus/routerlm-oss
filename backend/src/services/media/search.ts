import type { Runtime } from "../../runtime";
import type { ApiKeyRecord } from "../../db/repositories";
import { handleSearchCore } from "./search/index.ts";
import { comboModelList, enforceApiKeyAccess, errorResponse, mediaFallbackLoop, mediaComboDispatch, mediaModelInfo, mediaUsage, providerSupports } from "./shared";

const log = { debug() {}, info() {}, warn() {}, error() {} };

interface SearchInput {
  body: Record<string, unknown>;
  apiKey: ApiKeyRecord | null;
  clientIp?: string;
}

async function searchSingleProvider(runtime: Runtime, body: Record<string, unknown>, providerInput: string, apiKey: ApiKeyRecord | null, clientIp?: string): Promise<Response> {
  const resolved = providerSupports(runtime, providerInput);
  if (!resolved) return errorResponse(400, `Unknown provider: ${providerInput}`);

  const providerConfig = resolved.entry.searchConfig;
  const supportsSearch = Boolean(providerConfig) || Boolean(resolved.entry.searchViaChat);
  if (!supportsSearch) return errorResponse(400, `Provider ${resolved.id} does not support web search`);

  const coreBody = {
    query: String(body.query).trim(),
    provider: resolved.id,
    max_results: body.max_results,
    search_type: body.search_type,
    country: body.country,
    language: body.language,
    time_range: body.time_range,
    offset: body.offset,
    domain_filter: body.domain_filter,
    content_options: body.content_options,
    provider_options: body.provider_options,
  };

  // No-auth providers (e.g. searxng) bypass credential lookup entirely.
  if (resolved.entry.noAuth) {
    const result = await handleSearchCore({ body: coreBody, provider: resolved.entry, providerConfig, credentials: null, log });
    return result.response;
  }

  return mediaFallbackLoop(runtime, resolved.id, null, async (connection, credentials) => {
    const result = await handleSearchCore({ body: coreBody, provider: resolved.entry, providerConfig, credentials, log });
    if (result.success) {
      mediaUsage(runtime, { provider: resolved.id, model: resolved.id, connectionId: connection.id, apiKey, endpoint: "/v1/search", clientIp });
    }
    return result as { success: boolean; response: Response; status?: number; error?: string };
  });
}

// POST /v1/search — the provider IS the model; a combo name fans out across
// its member providers with sequential fallback.
export async function handleMediaSearch(runtime: Runtime, input: SearchInput): Promise<Response> {
  const providerInput = input.body.provider || input.body.model;
  const query = input.body.query;

  if (!providerInput || typeof providerInput !== "string") return errorResponse(400, "Missing required field: provider (or model)");
  if (!query || typeof query !== "string" || !query.trim()) return errorResponse(400, "Missing required field: query");

  const info = mediaModelInfo(runtime, String(providerInput));
  const blocked = enforceApiKeyAccess(input.apiKey, String(providerInput), { isCombo: info.isCombo === true });
  if (blocked) return blocked;

  if (info.isCombo && info.comboModels?.length) {
    return mediaComboDispatch(runtime, String(providerInput), info.comboModels, input.body, (body, model) =>
      searchSingleProvider(runtime, body, model, input.apiKey, input.clientIp));
  }

  return searchSingleProvider(runtime, input.body, String(providerInput), input.apiKey, input.clientIp);
}
