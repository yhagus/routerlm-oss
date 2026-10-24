// The v1 registry is the source of truth for provider identity and capabilities.
// Keep this adapter small: registry entries contain runtime functions and transport
// details that should not leak into management API responses.
import registry from "./registry/index.ts";
import { customNodeType } from "./customNodes.ts";

export interface ProviderCatalogEntry {
  id: string;
  alias: string;
  name: string;
  category: string | null;
  authModes: string[];
  authType: string | null;
  priority: number;
  mediaPriority: number | null;
  hidden: boolean;
  hiddenKinds: string[];
  deprecated: boolean;
  noAuth: boolean;
  serviceKinds: string[];
  models: Array<Record<string, unknown>>;
  display: Record<string, unknown>;
  hasOAuth: boolean;
  hasNativeAuth: boolean;
  hasProviderSpecificData: boolean;
  refreshUrl: string | null;
  clientId: string | null;
  clientSecret: string | null;
}

type RegistryEntry = Record<string, any>;

export interface ProviderTransport {
  format: string;
  baseUrl: string;
  headers?: Record<string, string>;
  auth?: { combined: boolean; header: string; scheme: "bearer" | "raw"; anthropicVersion?: boolean };
}

const zenmuxEntry: RegistryEntry = {
  id: "zenmux",
  priority: 121,
  alias: "zenmux",
  display: {
    name: "ZenMux",
    color: "#7C3AED",
    textIcon: "ZM",
    website: "https://zenmux.ai",
    notice: { apiKeyUrl: "https://zenmux.ai" },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://zenmux.ai/api/v1/chat/completions",
    format: "openai",
    validateUrl: "https://zenmux.ai/api/v1/models",
  },
  transports: [
    { format: "openai", baseUrl: "https://zenmux.ai/api/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
    { format: "openai-responses", baseUrl: "https://zenmux.ai/api/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
    { format: "claude", baseUrl: "https://zenmux.ai/api/anthropic/v1/messages", headers: { "anthropic-version": "2023-06-01" }, auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true } },
  ] satisfies ProviderTransport[],
  models: [] as any[],
  passthroughModels: true,
};

const gmiCloudEntry: RegistryEntry = {
  id: "gmi-cloud",
  priority: 120,
  alias: "gmicloud",
  display: {
    name: "GMI Cloud",
    color: "#0EA5E9",
    textIcon: "GM",
    website: "https://www.gmicloud.ai",
    notice: { apiKeyUrl: "https://www.gmicloud.ai" },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://api.gmi-serving.com/v1/chat/completions",
    validateUrl: "https://api.gmi-serving.com/v1/models",
    format: "openai",
  },
  transports: [
    { format: "openai", baseUrl: "https://api.gmi-serving.com/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ] satisfies ProviderTransport[],
  models: [{ id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" }],
  passthroughModels: true,
};

const autoclawEntry: RegistryEntry = {
  id: "autoclaw",
  priority: 122,
  alias: "autoclaw",
  display: {
    name: "AutoClaw",
    color: "#0EA5E9",
    textIcon: "AC",
    website: "https://autoclaw.z.ai",
    notice: { signupUrl: "https://autoclaw.z.ai" },
  },
  category: "oauth",
  authType: "apikey",
  authModes: ["apikey"],
  serviceKinds: ["llm"],
  features: { usage: true, usageApikey: true },
  transport: {
    baseUrl: "https://autoglm-api.autoglm.ai/autoclaw-proxy/proxy/autoclaw/v1/chat/completions",
    format: "openai",
    forceStream: true,
  },
  transports: [
    { format: "openai", baseUrl: "https://autoglm-api.autoglm.ai/autoclaw-proxy/proxy/autoclaw/v1/chat/completions", auth: { combined: true, header: "X-Authorization", scheme: "bearer" } },
  ] satisfies ProviderTransport[],
  models: [
    { id: "zaicoding_glm-5.3", name: "GLM-5.3", contextLength: 1048576, maxOutputTokens: 307200 },
    { id: "zai_auto", name: "Auto", contextLength: 1048576, maxOutputTokens: 393216 },
    { id: "zai_glm-5-turbo", name: "GLM-5-Turbo", contextLength: 204800, maxOutputTokens: 131072 },
    { id: "tdpsk_deepseek-v4-flash-202605", name: "DeepSeek-V4-Flash", contextLength: 1048576, maxOutputTokens: 393216 },
    { id: "tdpsk_deepseek-v4-pro-202606", name: "DeepSeek-V4-Pro", contextLength: 1048576, maxOutputTokens: 393216 },
  ],
  passthroughModels: true,
};

const bitdeerEntry: RegistryEntry = {
  id: "bitdeer",
  priority: 123,
  alias: "bitdeer",
  display: {
    name: "BitDeer AI",
    color: "#36D0AC",
    textIcon: "BD",
    website: "https://www.bitdeer.ai",
    notice: { apiKeyUrl: "https://www.bitdeer.ai/en/model/apikeys" },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://api-inference.bitdeer.ai/v1/chat/completions",
    validateUrl: "https://api-inference.bitdeer.ai/v1/models",
    format: "openai",
  },
  transports: [
    { format: "openai", baseUrl: "https://api-inference.bitdeer.ai/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ] satisfies ProviderTransport[],
  models: [
    { id: "zai-org/GLM-5.2", name: "GLM-5.2" },
    { id: "moonshotai/Kimi-K3", name: "Kimi K3" },
    { id: "Qwen/Qwen3.5-397B-A17B", name: "Qwen3.5-397B-A17B" },
    { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "nvidia/Nemotron-3-Nano-Omni-30B-A3B", name: "Nemotron-3-Nano-Omni-30B-A3B" },
    { id: "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B", name: "Nemotron-3-Super-120B-A12B" },
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" },
    { id: "XiaomiMiMo/MiMo-V2.5-Pro", name: "MiMo V2.5 Pro" },
    { id: "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B", name: "Nemotron-3-Ultra-550B-A55B" },
  ],
  passthroughModels: true,
};

const orcarouterEntry: RegistryEntry = {
  id: "orcarouter",
  priority: 124,
  alias: "orcarouter",
  display: {
    name: "OrcaRouter",
    color: "#2563EB",
    textIcon: "OR",
    website: "https://www.orcarouter.ai",
    notice: { apiKeyUrl: "https://www.orcarouter.ai/console" },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://api.orcarouter.ai/v1/chat/completions",
    validateUrl: "https://api.orcarouter.ai/v1/models",
    format: "openai",
  },
  // Every chat model speaks chat completions; only a subset supports
  // /v1/responses or /v1/messages, so keep the single universal transport.
  transports: [
    { format: "openai", baseUrl: "https://api.orcarouter.ai/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ] satisfies ProviderTransport[],
  models: [
    { id: "orcarouter/fusion", name: "Fusion" },
    { id: "orcarouter/free", name: "Free" },
    { id: "openai/gpt-4o-mini", name: "GPT-4o mini" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
  ],
  passthroughModels: true,
};

function entryToCatalog(entry: RegistryEntry): ProviderCatalogEntry {
  const category = typeof entry.category === "string" ? entry.category : null;
  const defaultMode = category === "oauth" ? "oauth" : category === "native" ? "native" : category === "webCookie" ? "cookie" : category === "apikey" ? "apikey" : null;
  const authModes = Array.isArray(entry.authModes) && entry.authModes.length
    ? entry.authModes.map(String)
    : defaultMode ? [defaultMode] : [];

  return {
    id: String(entry.id),
    alias: String(entry.uiAlias || entry.alias || entry.id),
    name: String(entry.display?.name || entry.id),
    category,
    authModes,
    authType: entry.authType == null ? null : String(entry.authType),
    priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 999,
    mediaPriority: Number.isFinite(Number(entry.mediaPriority)) ? Number(entry.mediaPriority) : null,
    hidden: entry.hidden === true,
    hiddenKinds: Array.isArray(entry.hiddenKinds) ? entry.hiddenKinds.map(String) : [],
    deprecated: entry.display?.deprecated === true,
    noAuth: entry.noAuth === true,
    serviceKinds: Array.isArray(entry.serviceKinds) ? entry.serviceKinds.map(String) : ["llm"],
    models: Array.isArray(entry.models) ? entry.models.map((model: unknown) => typeof model === "string" ? { id: model, name: model } : model as Record<string, unknown>) : [],
    display: { ...(entry.display || {}) },
    hasOAuth: entry.hasOAuth === true || Boolean(entry.oauth),
    hasNativeAuth: entry.hasNativeAuth === true || Boolean(entry.nativeAuth),
    hasProviderSpecificData: entry.hasProviderSpecificData === true,
    refreshUrl: typeof entry.transport?.refreshUrl === "string" ? entry.transport.refreshUrl : typeof entry.transport?.tokenUrl === "string" ? entry.transport.tokenUrl : null,
    clientId: typeof entry.transport?.clientId === "string" ? entry.transport.clientId : null,
    clientSecret: typeof entry.transport?.clientSecret === "string" ? entry.transport.clientSecret : null,
  };
}

const runtimeEntries = [...(registry as RegistryEntry[]), zenmuxEntry, gmiCloudEntry, autoclawEntry, bitdeerEntry, orcarouterEntry];
const catalog = runtimeEntries.map(entryToCatalog);
const byId = new Map(catalog.map((entry) => [entry.id, entry]));
const byAlias = new Map(catalog.flatMap((entry) => [[entry.id, entry], [entry.alias, entry]]));
const runtimeById = new Map(runtimeEntries.map((entry) => [String(entry.id), entry]));

export function getProviderCatalog(): ProviderCatalogEntry[] {
  return [...catalog].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

export function getProviderMetadata(idOrAlias: string | null | undefined): ProviderCatalogEntry | null {
  if (!idOrAlias) return null;
  return byId.get(idOrAlias) || byAlias.get(idOrAlias) || null;
}

export function resolveProviderId(idOrAlias: string): string {
  return getProviderMetadata(idOrAlias)?.id || idOrAlias;
}

export function getProviderRuntimeTransport(idOrAlias: string): { baseUrl: string | null; format: string | null } | null {
  const provider = resolveProviderId(idOrAlias);
  const transport = runtimeById.get(provider)?.transport;
  if (!transport || typeof transport !== "object") return null;
  return {
    baseUrl: typeof transport.baseUrl === "string" ? transport.baseUrl : null,
    format: typeof transport.format === "string" ? transport.format : null,
  };
}

export function resolveProviderTransport(idOrAlias: string, sourceFormat: string): ProviderTransport | null {
  const entry = runtimeById.get(resolveProviderId(idOrAlias));
  const transports = entry?.transports;
  if (!Array.isArray(transports)) return null;
  const transport = transports.find((candidate: ProviderTransport) => candidate?.format === sourceFormat);
  return transport || null;
}

export function getProviderModelDiscoveryUrl(idOrAlias: string): string | null {
  const entry = runtimeById.get(resolveProviderId(idOrAlias));
  const url = entry?.transport?.validateUrl;
  return typeof url === "string" ? url : null;
}

export function isCompatibleProvider(id: string): boolean {
  return customNodeType(id) !== null;
}

// Same registry feature flags v1 derives USAGE_SUPPORTED_PROVIDERS / USAGE_APIKEY_PROVIDERS from.
export function usageSupportedProviderIds(): string[] {
  return catalog.filter((_, index) => Boolean(runtimeEntries[index]?.features?.usage)).map((entry) => entry.id);
}

export function usageApiKeyProviderIds(): string[] {
  return catalog.filter((_, index) => Boolean(runtimeEntries[index]?.features?.usageApikey)).map((entry) => entry.id);
}

export function isUsageSupportedProvider(idOrAlias: string): boolean {
  const entry = runtimeById.get(resolveProviderId(idOrAlias)) as RegistryEntry | undefined;
  return Boolean(entry?.features?.usage);
}

export function isUsageApiKeyProvider(idOrAlias: string): boolean {
  const entry = runtimeById.get(resolveProviderId(idOrAlias)) as RegistryEntry | undefined;
  return Boolean(entry?.features?.usageApikey);
}

// Registry usage block: upstream quota/reset-credit endpoints per provider.
export function getProviderUsageConfig(idOrAlias: string): { url: string | null; resetCreditsUrl: string | null; resetCreditsConsumeUrl: string | null } {
  const entry = runtimeById.get(resolveProviderId(idOrAlias)) as RegistryEntry | undefined;
  const usage = (entry?.usage ?? (entry?.transport as RegistryEntry | undefined)?.usage) as Record<string, unknown> | undefined;
  return {
    url: typeof usage?.url === "string" ? usage.url : null,
    resetCreditsUrl: typeof usage?.resetCreditsUrl === "string" ? usage.resetCreditsUrl : null,
    resetCreditsConsumeUrl: typeof usage?.resetCreditsConsumeUrl === "string" ? usage.resetCreditsConsumeUrl : null,
  };
}

// The raw registry entry: media families (ttsConfig, sttConfig, imageConfig,
// embeddingConfig, videoConfig, searchConfig, searchViaChat, fetchConfig) are
// read from it directly, exactly like v1's AI_PROVIDERS media-field mapping.
export function getProviderRegistryEntry(idOrAlias: string): RegistryEntry | null {
  return (runtimeById.get(resolveProviderId(idOrAlias)) as RegistryEntry | undefined) || null;
}

export function providerAcceptsApiKey(entry: ProviderCatalogEntry | null): boolean {
  return Boolean(entry?.authModes.includes("apikey") || entry?.category === "apikey");
}

export function providerRequiresCredential(entry: ProviderCatalogEntry | null): boolean {
  if (!entry || entry.id === "local-device") return false;
  // A noAuth provider that declares API key auth only stores accounts that hold a key.
  return !entry.noAuth || entry.authModes.includes("apikey");
}
