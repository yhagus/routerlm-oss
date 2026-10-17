import type { Runtime } from "../../runtime";
import type { ApiKeyRecord, ProviderConnection } from "../../db/repositories";
import { getImageAdapter } from "./images/index.ts";
import { urlToBase64 } from "./images/_base.ts";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../common/error.ts";
import { enforceApiKeyAccess, errorResponse, mediaFallbackLoop, mediaComboDispatch, mediaModelInfo, mediaUsage, refreshMediaCredentials, type CoreResult } from "./shared";

const log = { debug() {}, info() {}, warn() {}, error() {} };

function serializeRequestBody(requestBody: unknown): BodyInit {
  if (typeof FormData !== "undefined" && requestBody instanceof FormData) return requestBody;
  if (typeof requestBody === "string") return requestBody;
  return JSON.stringify(requestBody);
}

async function imageSuccessResponse(finalBody: Record<string, any>, body: Record<string, unknown>, binaryOutput: boolean): Promise<CoreResult> {
  if (binaryOutput) {
    const first = finalBody.data?.[0];
    let b64 = first?.b64_json;
    if (!b64 && first?.url) {
      try { b64 = await urlToBase64(first.url); } catch { /* fall through to JSON */ }
    }
    if (b64) {
      const buffer = Buffer.from(b64, "base64");
      const fmt = String(body.output_format || "png").toLowerCase();
      const mime = fmt === "jpeg" || fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png";
      return {
        success: true,
        response: new Response(buffer, { headers: { "Content-Type": mime, "Content-Disposition": `inline; filename="image.${fmt === "jpeg" ? "jpg" : fmt}"`, "Access-Control-Allow-Origin": "*" } }),
      };
    }
  }
  return {
    success: true,
    response: new Response(JSON.stringify(finalBody), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }),
  };
}

// v1 handleImageGenerationCore flow with the v2 token refresh. Executor-
// delegating adapters (antigravity) run through the registered v1 executor.
async function imagesForConnection(runtime: Runtime, connection: ProviderConnection | null, credentials: Record<string, any> | null, provider: string, model: string, body: Record<string, unknown>, binaryOutput: boolean, apiKey: ApiKeyRecord | null, clientIp?: string, streamToClient?: boolean): Promise<CoreResult> {
  if (!body.prompt) return createErrorResult(400, "Missing required field: prompt") as CoreResult;
  const adapter = getImageAdapter(provider);
  if (!adapter) return createErrorResult(400, `Provider '${provider}' does not support image generation`) as CoreResult;

  // Executor-delegating adapters: skip manual URL/headers/body, use the proven executor flow.
  if (adapter.useExecutor && adapter.executeViaExecutor) {
    try {
      const responseBody = await adapter.executeViaExecutor(model, body, credentials, log) as Record<string, any>;
      const normalized = adapter.normalize(responseBody, body.prompt) as Record<string, any>;
      const finalBody = normalized.created && Array.isArray(normalized.data) ? normalized : responseBody;
      mediaUsage(runtime, { provider, model, connectionId: connection?.id, apiKey, endpoint: "/v1/images/generations", clientIp });
      return imageSuccessResponse(finalBody, body, binaryOutput);
    } catch (error: any) {
      return createErrorResult(502, formatProviderError(error, provider, model, 502)) as CoreResult;
    }
  }

  let url: string;
  let headers: Record<string, string>;
  let requestBody: unknown;
  try {
    url = adapter.buildUrl(model, credentials);
    requestBody = await adapter.buildBody(model, body);
    headers = adapter.buildHeaders(credentials, requestBody, model, body);
  } catch (error: any) {
    return createErrorResult(400, (error as Error).message || `Invalid ${provider} image request`) as CoreResult;
  }

  let providerResponse: Response;
  const fetchTimeout = adapter.fetchTimeoutMs || 110_000;
  try {
    providerResponse = await fetch(url, { method: "POST", headers, body: serializeRequestBody(requestBody), signal: AbortSignal.timeout(fetchTimeout) });
  } catch (error: any) {
    return createErrorResult(502, formatProviderError(error, provider, model, 502)) as CoreResult;
  }

  if ((providerResponse.status === 401 || providerResponse.status === 403) && !adapter.noAuth && credentials?.refreshToken && connection) {
    const merged = await refreshMediaCredentials(runtime, connection.id, credentials);
    if (merged) {
      try {
        const retryBody = await adapter.buildBody(model, body);
        providerResponse = await fetch(adapter.buildUrl(model, merged), { method: "POST", headers: adapter.buildHeaders(merged, retryBody, model, body), body: serializeRequestBody(retryBody), signal: AbortSignal.timeout(fetchTimeout) });
      } catch { /* retry failed; report the original response below */ }
    }
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    return createErrorResult(statusCode, formatProviderError(new Error(message), provider, model, statusCode)) as CoreResult;
  }

  // Adapter may override parsing (async polling, SSE streaming, binary forms).
  let parsed: any;
  try {
    if (adapter.parseResponse) {
      const onRequestSuccess = () => mediaUsage(runtime, { provider, model, connectionId: connection?.id, apiKey, endpoint: "/v1/images/generations", clientIp });
      parsed = await adapter.parseResponse(providerResponse, { headers, log, streamToClient: streamToClient || false, onRequestSuccess, url, requestBody, model, body });
      if (parsed?.sseResponse) return { success: true, response: parsed.sseResponse };
    } else {
      parsed = await providerResponse.json();
    }
  } catch (error: any) {
    return createErrorResult(502, (error as Error).message || `Invalid response from ${provider}`) as CoreResult;
  }

  const normalized = adapter.normalize(parsed, body.prompt);
  const finalBody = normalized.created && Array.isArray(normalized.data) ? normalized : parsed;
  mediaUsage(runtime, { provider, model, connectionId: connection?.id, apiKey, endpoint: "/v1/images/generations", clientIp });
  return imageSuccessResponse(finalBody, body, binaryOutput);
}

interface ImageInput {
  body: Record<string, unknown>;
  binaryOutput: boolean;
  stream: boolean;
  apiKey: ApiKeyRecord | null;
  clientIp?: string;
}

async function imagesSingleModel(runtime: Runtime, input: ImageInput, modelStr: string, skipModelGate: boolean): Promise<Response> {
  const info = mediaModelInfo(runtime, modelStr);
  if (!info.provider) return errorResponse(400, "Invalid model format");
  if (!skipModelGate) {
    const blocked = enforceApiKeyAccess(input.apiKey, modelStr);
    if (blocked) return blocked;
  }

  const adapter = getImageAdapter(info.provider);
  if (adapter?.noAuth) {
    return imagesForConnection(runtime, null, null, info.provider, info.model, input.body, input.binaryOutput, input.apiKey, input.clientIp, input.stream).then((result) =>
      result.success ? result.response : errorResponse(result.status || 502, result.error || "Image generation failed"));
  }

  return mediaFallbackLoop(runtime, info.provider, info.model, (connection, credentials) =>
    imagesForConnection(runtime, connection, credentials, info.provider!, info.model, input.body, input.binaryOutput, input.apiKey, input.clientIp, input.stream));
}

// POST /v1/images/generations — OpenAI-compatible image endpoint.
export async function handleMediaImages(runtime: Runtime, input: ImageInput): Promise<Response> {
  const modelStr = input.body.model;
  if (!modelStr) return errorResponse(400, "Missing model");
  if (!input.body.prompt) return errorResponse(400, "Missing required field: prompt");

  const info = mediaModelInfo(runtime, String(modelStr));
  if (info.isCombo && info.comboModels?.length) {
    return mediaComboDispatch(runtime, String(modelStr), info.comboModels, input.body, (body, model) =>
      imagesSingleModel(runtime, { ...input, body }, model, true));
  }

  return imagesSingleModel(runtime, input, String(modelStr), false);
}
