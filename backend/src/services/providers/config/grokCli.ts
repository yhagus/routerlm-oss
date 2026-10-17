export const GROK_CLI_VERSION = "1.0.13";
export const GROK_CLI_MODEL = "grok-build";
export const GROK_CLI_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const GROK_CLI_XAI_BASE_URL = "https://api.x.ai/v1";
export const GROK_CLI_VIDEO_BASE_URL = "https://api.x.ai/v1/videos";
export const GROK_CLI_CLIENT_IDENTIFIER = "grok-shell";
export const GROK_CLI_TOKEN_AUTH = "xai-grok-cli";
export const GROK_CLI_AUTHENTICATE_RESPONSE = "authenticate-response";
export const GROK_CLI_CLIENT_MODE = "headless";
export const GROK_CLI_USER_AGENT = `grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`;
export const GROK_CLI_AVAILABILITY_PROBE_MODEL = "grok-4.5-low";
export const GROK_CLI_FREE_USAGE_TOKEN_LIMIT = 1_000_000;
export const GROK_CLI_FREE_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;
// This is a local recovery probe time, not an upstream reset timestamp.
export const GROK_CLI_FREE_USAGE_PROBE_COOLDOWN_MS = GROK_CLI_FREE_USAGE_WINDOW_MS;

// The official inference path (xai-grok-shell inject_url_derived_headers) attaches
// X-XAI-Token-Auth + x-authenticateresponse only for cli-chat-proxy bases, while
// x-grok-client-mode is sent unconditionally. Mirror that gate so the api.x.ai
// fallback plane does not carry proxy-only auth headers.
export function isGrokCliProxyUrl(url: any) {
  try {
    const host = new URL(String(url)).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    const proxyHost = new URL(GROK_CLI_BASE_URL).hostname;
    return host === proxyHost || host.endsWith(`.${proxyHost}`);
  } catch {
    return false;
  }
}

// Models that support reasoning effort (for grok-cli provider)
export function supportsGrokCliReasoningEffort(model: any, modelInfo: any = null) {
  const id = String(model || "");
  if (/grok-composer/i.test(id) || /^grok-4\.20-0309-reasoning$/i.test(id)) return false;
  if (modelInfo?.supportsReasoningEffort === false) return false;
  return modelInfo?.supportsReasoningEffort === true || /^grok-4\.5(?:$|-)/.test(id);
}

// Grok video generation models
export const GROK_VIDEO_MODELS: Record<string, any> = {
  "grok-imagine-video": {
    id: "grok-imagine-video",
    name: "Grok Imagine Video",
    maxDuration: 8,
    defaultResolution: "720p",
    supportedResolutions: ["720p"],
    supportedAspectRatios: ["16:9", "16:10", "1:1"],
  },
};

export function getVideoModelInfo(modelId: any) {
  return GROK_VIDEO_MODELS[modelId] || GROK_VIDEO_MODELS["grok-imagine-video"];
}
