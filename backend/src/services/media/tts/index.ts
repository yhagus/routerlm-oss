// TTS provider registry
import googleTts from "./googleTts.ts";
import edgeTts, { fetchEdgeTtsVoices } from "./edgeTts.ts";
import localDevice, { fetchLocalDeviceVoices } from "./localDevice.ts";
import elevenlabs, { fetchElevenLabsVoices } from "./elevenlabs.ts";
import openai from "./openai.ts";
import { FORMAT_HANDLERS } from "./genericFormats.ts";
import { parseModelVoice } from "./_base.ts";

// Special providers with custom synthesize() logic
const SPECIAL_ADAPTERS: Record<string, any> = {
  "google-tts": googleTts,
  "edge-tts": edgeTts,
  "local-device": localDevice,
  elevenlabs,
  openai,
};

export function getTtsAdapter(provider: any): any {
  return SPECIAL_ADAPTERS[provider] || null;
}

// Generic config-driven dispatcher (uses ttsConfig.format)
export async function synthesizeViaConfig(provider: any, text: any, model: any, credentials: any) {
  const { AI_PROVIDERS } = await import("../../platform/shared/constants/providers");
  const cfg = AI_PROVIDERS[provider]?.ttsConfig;
  if (!cfg) return null;
  const handler = (FORMAT_HANDLERS as Record<string, any>)[cfg.format];
  if (!handler) return null;
  const apiKey = credentials?.apiKey;
  if (cfg.authType !== "none" && !apiKey) throw new Error(`${provider} API key required`);
  const { PROVIDER_MODELS } = await import("../../providers/config/providerModels.ts");
  const ttsModels = (PROVIDER_MODELS[provider] || []).filter((m: any) => (m.kind || m.type) === "tts");
  const defaultModel = ttsModels[0]?.id || "";
  const { modelId, voiceId } = parseModelVoice(model, defaultModel, "", ttsModels);
  return handler({ baseUrl: cfg.baseUrl, apiKey, text, modelId, voiceId });
}

// Voice fetchers (used by /api/media-providers/tts/voices route)
export const VOICE_FETCHERS = {
  "edge-tts": fetchEdgeTtsVoices,
  "local-device": fetchLocalDeviceVoices,
  elevenlabs: fetchElevenLabsVoices,
};

// Re-export for backward compat
export { fetchEdgeTtsVoices, fetchLocalDeviceVoices, fetchElevenLabsVoices };
