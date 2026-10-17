import type { Runtime } from "../../runtime";
import type { ApiKeyRecord } from "../../db/repositories";
import { getTtsAdapter } from "./tts/index.ts";
import { FORMAT_HANDLERS } from "./tts/genericFormats.ts";
import { parseModelVoice } from "./tts/_base.ts";
import { createErrorResult } from "../common/error.ts";
// The v1 model registry is JavaScript and intentionally remains the source of truth.
import { PROVIDER_MODELS } from "../providers/config/providerModels.ts";
import { getProviderRegistryEntry } from "../providers/providerCatalog";
import { enforceApiKeyAccess, errorResponse, mediaFallbackLoop, mediaComboDispatch, mediaModelInfo, mediaUsage, type CoreResult } from "./shared";

function createTtsResponse(base64Audio: string, format: string, responseFormat: string): CoreResult {
  const audioBuffer = Buffer.from(base64Audio, "base64");
  if (responseFormat === "json") {
    return {
      success: true,
      response: new Response(JSON.stringify({ audio: base64Audio, format }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }),
    };
  }
  return {
    success: true,
    response: new Response(audioBuffer, { headers: { "Content-Type": `audio/${format}`, "Content-Length": String(audioBuffer.length), "Access-Control-Allow-Origin": "*" } }),
  };
}

// v1 synthesizeViaConfig, with ttsConfig read straight from the registry
// instead of the Next.js AI_PROVIDERS barrel.
function synthesizeViaConfig(provider: string, text: string, model: string, credentials: Record<string, any> | null | undefined) {
  const cfg = getProviderRegistryEntry(provider)?.ttsConfig as Record<string, any> | undefined;
  if (!cfg) return null;
  const handler = (FORMAT_HANDLERS as Record<string, any>)[cfg.format];
  if (!handler) return null;
  const apiKey = credentials?.apiKey;
  if (cfg.authType !== "none" && !apiKey) throw new Error(`${provider} API key required`);
  const ttsModels = ((PROVIDER_MODELS[provider] || []) as Array<Record<string, any>>).filter((entry) => (entry.kind || entry.type) === "tts");
  const defaultModel = ttsModels[0]?.id || "";
  const { modelId, voiceId } = parseModelVoice(model, defaultModel, "", ttsModels);
  return handler({ baseUrl: cfg.baseUrl, apiKey, text, modelId, voiceId });
}

async function ttsCore(provider: string, model: string, input: string, credentials: Record<string, any> | null | undefined, responseFormat: string, language: string): Promise<CoreResult> {
  if (!input?.trim()) return createErrorResult(400, "Missing required field: input") as CoreResult;
  try {
    const adapter = getTtsAdapter(provider);
    if (adapter) {
      const result = await adapter.synthesize(input.trim(), model, credentials, responseFormat, { language });
      if (result.success !== undefined) return result as CoreResult;
      return createTtsResponse(result.base64, result.format, responseFormat);
    }
    const result = await synthesizeViaConfig(provider, input.trim(), model, credentials);
    if (result) return createTtsResponse(result.base64, result.format, responseFormat);
    return createErrorResult(400, `Provider '${provider}' does not support TTS via this route.`) as CoreResult;
  } catch (error: any) {
    return createErrorResult(502, error instanceof Error ? error.message : "TTS synthesis failed") as CoreResult;
  }
}

interface TtsInput {
  body: Record<string, unknown>;
  responseFormat: string;
  apiKey: ApiKeyRecord | null;
  clientIp?: string;
}

async function ttsSingleModel(runtime: Runtime, input: TtsInput, modelStr: string, skipModelGate: boolean): Promise<Response> {
  const info = mediaModelInfo(runtime, modelStr);
  if (!info.provider) return errorResponse(400, "Invalid model format");

  if (!skipModelGate) {
    const blocked = enforceApiKeyAccess(input.apiKey, modelStr);
    if (blocked) return blocked;
  }

  const language = typeof input.body.language === "string" ? input.body.language : "";
  const entry = getProviderRegistryEntry(info.provider) as Record<string, any> | null;
  const credentialed = Boolean(entry?.serviceKinds?.includes?.("tts")) && !entry?.noAuth && entry?.ttsConfig?.authType !== "none";

  if (!credentialed) {
    const result = await ttsCore(info.provider, info.model, String(input.body.input), null, input.responseFormat, language);
    if (result.success) {
      mediaUsage(runtime, { provider: info.provider, model: info.model, endpoint: "/v1/audio/speech", apiKey: input.apiKey, clientIp: input.clientIp });
      return result.response;
    }
    return errorResponse(result.status || 502, result.error || "TTS failed");
  }

  return mediaFallbackLoop(runtime, info.provider, info.model, async (connection, credentials) => {
    const result = await ttsCore(info.provider!, info.model, String(input.body.input), credentials, input.responseFormat, language);
    if (result.success) {
      mediaUsage(runtime, { provider: info.provider!, model: info.model, connectionId: connection.id, endpoint: "/v1/audio/speech", apiKey: input.apiKey, clientIp: input.clientIp });
    }
    return result;
  });
}

// POST /v1/audio/speech — OpenAI-compatible TTS endpoint.
export async function handleMediaTts(runtime: Runtime, input: TtsInput): Promise<Response> {
  const modelStr = input.body.model;
  if (!modelStr) return errorResponse(400, "Missing model");
  if (!input.body.input) return errorResponse(400, "Missing required field: input");

  const info = mediaModelInfo(runtime, String(modelStr));
  if (info.isCombo && info.comboModels?.length) {
    return mediaComboDispatch(runtime, String(modelStr), info.comboModels, input.body, (body, model) =>
      ttsSingleModel(runtime, { ...input, body }, model, true));
  }

  return ttsSingleModel(runtime, input, String(modelStr), false);
}
