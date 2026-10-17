import type { Runtime } from "../../runtime";
import type { ApiKeyRecord, ProviderConnection } from "../../db/repositories";
import { getEmbeddingAdapter } from "./embeddings/index.ts";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../common/error.ts";
import { enforceApiKeyAccess, errorResponse, mediaFallbackLoop, mediaComboDispatch, mediaModelInfo, mediaUsage, refreshMediaCredentials, type CoreResult } from "./shared";

const log = { debug() {}, info() {}, warn() {}, error() {} };

// v1 handleEmbeddingsCore flow with the v2 token refresh: adapter
// buildUrl/buildHeaders/buildBody → fetch → 401/403 refresh retry → normalize.
async function embeddingsForConnection(runtime: Runtime, connection: ProviderConnection, credentials: Record<string, any>, provider: string, model: string, body: Record<string, unknown>, apiKey: ApiKeyRecord | null, clientIp?: string): Promise<CoreResult> {
  const input = body.input;
  if (!input) return createErrorResult(400, "Missing required field: input") as CoreResult;
  if (typeof input !== "string" && !Array.isArray(input)) return createErrorResult(400, "input must be a string or array of strings") as CoreResult;

  const adapter = getEmbeddingAdapter(provider);
  if (!adapter) return createErrorResult(400, `Provider '${provider}' does not support embeddings.`) as CoreResult;

  const ctx = { input };
  const url = adapter.buildUrl(model, credentials, ctx);
  const headers = adapter.buildHeaders(credentials, ctx);
  const requestBody = adapter.buildBody(model, { input, encoding_format: body.encoding_format || "float", dimensions: body.dimensions });

  let providerResponse: Response;
  try {
    providerResponse = await fetch(url, { method: "POST", headers, body: JSON.stringify(requestBody) });
  } catch (error: any) {
    const message = formatProviderError(error, provider, model, 502);
    return createErrorResult(502, message) as CoreResult;
  }

  // 401/403 → refresh once and retry (skip for noAuth providers).
  if ((providerResponse.status === 401 || providerResponse.status === 403) && credentials.refreshToken) {
    const merged = await refreshMediaCredentials(runtime, connection.id, credentials);
    if (merged) {
      try {
        providerResponse = await fetch(adapter.buildUrl(model, merged, ctx), { method: "POST", headers: adapter.buildHeaders(merged, ctx), body: JSON.stringify(requestBody) });
      } catch { /* retry failed; report the original response below */ }
    }
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    return createErrorResult(statusCode, formatProviderError(new Error(message), provider, model, statusCode)) as CoreResult;
  }

  let responseBody: Record<string, unknown>;
  try {
    responseBody = await providerResponse.json();
  } catch {
    return createErrorResult(502, `Invalid JSON response from ${provider}`) as CoreResult;
  }

  const normalized = adapter.normalize(responseBody, model);
  const usage = (normalized.usage || {}) as Record<string, unknown>;
  mediaUsage(runtime, { provider, model, connectionId: connection.id, apiKey, endpoint: "/v1/embeddings", clientIp, promptTokens: Number(usage.prompt_tokens || usage.total_tokens || 0) });
  return {
    success: true,
    response: new Response(JSON.stringify(normalized), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }),
  };
}

// POST /v1/embeddings — OpenAI-compatible embedding endpoint.
export async function handleMediaEmbeddings(runtime: Runtime, input: { body: Record<string, unknown>; apiKey: ApiKeyRecord | null; clientIp?: string }): Promise<Response> {
  const modelStr = input.body.model;
  if (!modelStr || typeof modelStr !== "string") return errorResponse(400, "Missing required field: model");

  const info = mediaModelInfo(runtime, modelStr);
  const blocked = enforceApiKeyAccess(input.apiKey, modelStr, { isCombo: info.isCombo === true });
  if (blocked) return blocked;

  if (info.isCombo && info.comboModels?.length) {
    return mediaComboDispatch(runtime, String(modelStr), info.comboModels, input.body, (body, model) =>
      handleMediaEmbeddings(runtime, { ...input, body: { ...body, model } }));
  }
  if (!info.provider) return errorResponse(400, "Invalid model format");

  return mediaFallbackLoop(runtime, info.provider, info.model, (connection, credentials) =>
    embeddingsForConnection(runtime, connection, credentials, info.provider!, info.model, input.body, input.apiKey, input.clientIp));
}
