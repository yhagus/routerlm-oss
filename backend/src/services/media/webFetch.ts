import type { Runtime } from "../../runtime";
import type { ApiKeyRecord } from "../../db/repositories";
import { handleFetchCore } from "./fetch/index.ts";
import { assertPublicUrl } from "../platform/shared/utils/ssrfGuard.ts";
import { enforceApiKeyAccess, errorResponse, mediaFallbackLoop, mediaComboDispatch, mediaModelInfo, mediaUsage, providerSupports } from "./shared";

const log = { debug() {}, info() {}, warn() {}, error() {} };

interface FetchInput {
  body: Record<string, unknown>;
  apiKey: ApiKeyRecord | null;
  clientIp?: string;
}

async function fetchSingleProvider(runtime: Runtime, body: Record<string, unknown>, providerInput: string, apiKey: ApiKeyRecord | null, clientIp?: string): Promise<Response> {
  const resolved = providerSupports(runtime, providerInput);
  if (!resolved) return errorResponse(400, `Unknown provider: ${providerInput}`);

  const providerConfig = resolved.entry.fetchConfig;
  if (!providerConfig) return errorResponse(400, `Provider ${resolved.id} does not support web fetch`);

  const targetUrl = String(body.url);
  const successResponse = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

  if (resolved.entry.noAuth) {
    const result = await handleFetchCore({ url: targetUrl, format: body.format, maxCharacters: body.max_characters, provider: resolved.id, providerConfig, credentials: null, log });
    if (result.success) {
      mediaUsage(runtime, { provider: resolved.id, model: resolved.id, endpoint: "/v1/web/fetch", apiKey, clientIp });
      return successResponse(result.data);
    }
    return errorResponse(result.status || 502, result.error || "Fetch failed");
  }

  return mediaFallbackLoop(runtime, resolved.id, null, async (connection, credentials) => {
    const result = await handleFetchCore({ url: targetUrl, format: body.format, maxCharacters: body.max_characters, provider: resolved.id, providerConfig, credentials, log });
    if (result.success) {
      mediaUsage(runtime, { provider: resolved.id, model: resolved.id, connectionId: connection.id, endpoint: "/v1/web/fetch", apiKey, clientIp });
      return { success: true, response: successResponse(result.data) };
    }
    return { success: false, response: errorResponse(result.status || 502, result.error || "Fetch failed"), status: result.status || 502, error: result.error };
  });
}

// POST /v1/web/fetch — the provider IS the model; URL extraction to markdown.
export async function handleMediaFetch(runtime: Runtime, input: FetchInput): Promise<Response> {
  const providerInput = input.body.provider || input.body.model;
  const targetUrl = input.body.url;

  if (!providerInput || typeof providerInput !== "string") return errorResponse(400, "Missing required field: provider (or model)");
  if (!targetUrl || typeof targetUrl !== "string") return errorResponse(400, "Missing required field: url");

  try {
    new URL(targetUrl);
  } catch {
    return errorResponse(400, "Invalid URL format");
  }

  // SSRF guard: reject internal/private/metadata targets.
  try {
    assertPublicUrl(targetUrl);
  } catch (error: any) {
    return errorResponse(400, error instanceof Error ? error.message : "URL is not allowed");
  }

  const info = mediaModelInfo(runtime, String(providerInput));
  const blocked = enforceApiKeyAccess(input.apiKey, String(providerInput), { isCombo: info.isCombo === true });
  if (blocked) return blocked;

  if (info.isCombo && info.comboModels?.length) {
    return mediaComboDispatch(runtime, String(providerInput), info.comboModels, input.body, (body, model) =>
      fetchSingleProvider(runtime, body, model, input.apiKey, input.clientIp));
  }

  return fetchSingleProvider(runtime, input.body, String(providerInput), input.apiKey, input.clientIp);
}
