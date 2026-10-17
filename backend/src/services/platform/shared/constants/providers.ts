// Provider definitions
import REGISTRY from "../../../providers/registry/index.ts";
import { RISK_NOTICE } from "./providersDisplay";
import { ANTHROPIC_COMPATIBLE_PREFIX, CUSTOM_EMBEDDING_PREFIX, OPENAI_COMPATIBLE_PREFIX, customNodeType } from "../../../providers/customNodes.ts";

const MEDIA_ENTRY_KEYS = [
  "serviceKinds", "ttsConfig", "sttConfig", "embeddingConfig",
  "imageConfig", "imageToTextConfig", "videoConfig", "musicConfig",
  "searchViaChat", "searchConfig", "fetchConfig",
  "modelsFetcher", "mediaPriority", "hiddenKinds",
];

// Build provider UI object from registry entry
function buildProviderEntry(r: any) {
  const mediaFields: Record<string, any> = {};
  if (r.media) Object.assign(mediaFields, r.media);
  for (const k of MEDIA_ENTRY_KEYS) {
    if (r[k] !== undefined) mediaFields[k] = r[k];
  }
  const display = { ...(r.display || {}) };
  if (display.deprecationNotice === "RISK_NOTICE") display.deprecationNotice = RISK_NOTICE;
  return {
    ...display,
    id: r.id,
    alias: r.uiAlias || r.alias,
    ...(r.hidden ? { hidden: true } : {}),
    ...mediaFields,
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
    ...(r.hasFree ? { hasFree: true } : {}),
    ...(r.thinkingConfig ? { thinkingConfig: r.thinkingConfig } : {}),
    ...(r.regions ? { regions: r.regions, defaultRegion: r.defaultRegion } : {}),
    ...(r.hasProviderSpecificData ? { hasProviderSpecificData: true } : {}),
    ...(r.noAuth ? { noAuth: true } : {}),
    ...(r.passthroughModels ? { passthroughModels: true } : {}),
    ...(r.hasOAuth ? { hasOAuth: true } : {}),
    ...(r.hasNativeAuth ? { hasNativeAuth: true } : {}),
    ...(r.authModes ? { authModes: r.authModes } : {}),
    ...(r.authType ? { authType: r.authType } : {}),
    ...(r.authHint ? { authHint: r.authHint } : {}),
  };
}

const byCategory = (cat: any) => Object.fromEntries(
  REGISTRY.filter(r => r.category === cat).map(r => [r.id, buildProviderEntry(r)])
);

export const FREE_PROVIDERS = byCategory("free");
export const FREE_TIER_PROVIDERS = byCategory("freeTier");

// Thinking config definitions
// options: list of selectable modes ("auto" = no override from server)
// defaultMode: fallback when user hasn't configured
// extended: claude-style thinking (thinking.type + budget_tokens) — used by most providers
// effort: openai-style reasoning_effort — only openai + codex
export const THINKING_CONFIG = {
  extended: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
    defaultBudgetTokens: 10000
  },
  effort: {
    options: ["auto", "none", "low", "medium", "high"],
    defaultMode: "auto"
  }
};

export const OAUTH_PROVIDERS = byCategory("oauth");
export const NATIVE_PROVIDERS = byCategory("native");
export const APIKEY_PROVIDERS = byCategory("apikey");

// Web Cookie Providers (use browser session cookie instead of API key)
export const WEB_COOKIE_PROVIDERS = byCategory("webCookie");

// Media provider kinds — each kind maps to a route and endpoint config
export const MEDIA_PROVIDER_KINDS = [
  { id: "embedding",   label: "Embedding",      icon: "data_array",        endpoint: { method: "POST", path: "/v1/embeddings" } },
  { id: "image",       label: "Text to Image",  icon: "brush",             endpoint: { method: "POST", path: "/v1/images/generations" } },
  { id: "imageToText", label: "Image to Text",  icon: "image_search",      endpoint: { method: "POST", path: "/v1/images/understanding" } },
  { id: "tts",         label: "Text To Speech", icon: "record_voice_over", endpoint: { method: "POST", path: "/v1/audio/speech" } },
  { id: "stt",         label: "Speech To Text", icon: "mic",               endpoint: { method: "POST", path: "/v1/audio/transcriptions" } },
  { id: "webSearch",   label: "Web Search",     icon: "travel_explore",    endpoint: { method: "POST", path: "/v1/search" } },
  { id: "webFetch",    label: "Web Fetch",      icon: "language",          endpoint: { method: "POST", path: "/v1/web/fetch" } },
  { id: "video",       label: "Video",          icon: "movie",             endpoint: { method: "POST", path: "/v1/videos/generations" } },
  { id: "music",       label: "Music",          icon: "music_note",        endpoint: { method: "POST", path: "/v1/audio/music" } },
];

export { OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX, CUSTOM_EMBEDDING_PREFIX };

export function isOpenAICompatibleProvider(providerId: any) {
  return customNodeType(providerId) === "openai-compatible";
}

export function isAnthropicCompatibleProvider(providerId: any) {
  return customNodeType(providerId) === "anthropic-compatible";
}

export function isCustomEmbeddingProvider(providerId: any) {
  return customNodeType(providerId) === "custom-embedding";
}

// All providers (combined)
export const AI_PROVIDERS = { ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...OAUTH_PROVIDERS, ...NATIVE_PROVIDERS, ...APIKEY_PROVIDERS, ...WEB_COOKIE_PROVIDERS };

// Auth methods
export const AUTH_METHODS = {
  oauth: { id: "oauth" },
  native: { id: "native" },
  apikey: { id: "apikey" },
  cookie: { id: "cookie" },
};

// Helper: Get provider by alias
export function getProviderByAlias(alias: any): any {
  for (const provider of Object.values(AI_PROVIDERS)) {
    if ((provider as any).alias === alias || (provider as any).id === alias) {
      return provider;
    }
  }
  return null;
}

// Helper: Get provider ID from alias
export function resolveProviderId(aliasOrId: any) {
  const provider = getProviderByAlias(aliasOrId);
  return (provider as any)?.id || aliasOrId;
}

// Helper: Get alias from provider ID
export function getProviderAlias(providerId: any) {
  const provider = (AI_PROVIDERS as any)[providerId];
  return provider?.alias || providerId;
}

// Alias to ID mapping (for quick lookup)
export const ALIAS_TO_ID = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  (acc as any)[(p as any).alias] = (p as any).id;
  return acc;
}, {});

// ID to Alias mapping
export const ID_TO_ALIAS = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  (acc as any)[(p as any).id] = (p as any).alias;
  return acc;
}, {});

// Helper: Get providers by service kind (e.g. "tts", "embedding", "image")
// Providers without serviceKinds default to ["llm"]
export function getProvidersByKind(kind: any) {
  return Object.values(AI_PROVIDERS)
    .filter((p) => {
      const kinds = (p as any).serviceKinds ?? ["llm"];
      if (!kinds.includes(kind)) return false;
      if ((p as any).hidden) return false;
      if ((p as any).hiddenKinds?.includes(kind)) return false;
      return true;
    })
    .sort((a, b) => ((a as any).priority ?? (a as any).mediaPriority ?? 999) - ((b as any).priority ?? (b as any).mediaPriority ?? 999));
}

// Derive từ registry features flags
export const USAGE_SUPPORTED_PROVIDERS = REGISTRY
  .filter(r => r.features?.usage)
  .map(r => r.id);

export const USAGE_APIKEY_PROVIDERS = REGISTRY
  .filter(r => r.features?.usageApikey)
  .map(r => r.id);
