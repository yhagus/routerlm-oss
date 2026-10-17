import { PROVIDERS } from "./providers.ts";
import REGISTRY from "../registry/index.ts";
// PROVIDER_MODELS now built from providers/registry (transport + models co-located)
import { PROVIDER_MODELS } from "../index.ts";
import { modelQuotaFamily, modelStrip, modelTargetFormat } from "../models/schema.ts";
import { CODEX_REVIEW_SUFFIX } from "../models/helpers.ts";
export { PROVIDER_MODELS };

// === Grok CLI / Build Combo Models ===
// High/Medium/Low reasoning effort variants for grok-4.5
export const GROK_COMBO_MODELS = [
  { id: "grok-4.5-high", name: "Grok 4.5 (High)", upstreamModelId: "grok-4.5" },
  { id: "grok-4.5-medium", name: "Grok 4.5 (Medium)", upstreamModelId: "grok-4.5" },
  { id: "grok-4.5-low", name: "Grok 4.5 (Low)", upstreamModelId: "grok-4.5" },
];


// Helper functions
export function getProviderModels(aliasOrId: any) {
  return PROVIDER_MODELS[aliasOrId] || [];
}

export function getDefaultModel(aliasOrId: any) {
  const models = PROVIDER_MODELS[aliasOrId];
  return models?.[0]?.id || null;
}

function findModel(models: any, modelId: any) {
  return models?.find((m: any) => m.id === modelId);
}

export function isValidModel(aliasOrId: any, modelId: any, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return !!findModel(models, modelId);
}

export function findModelName(aliasOrId: any, modelId: any) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return modelId;
  const found = findModel(models, modelId);
  return found?.name || modelId;
}

export function getModelTargetFormat(aliasOrId: any, modelId: any) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  return modelTargetFormat(findModel(models, modelId));
}

export function getModelType(aliasOrId: any, modelId: any) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = findModel(models, modelId);
  return found?.kind || found?.type || null;
}

export function getModelUpstreamId(aliasOrId: any, modelId: any) {
  // Split off thinking suffix "(level)" so lookup hits the base id; re-append it to
  // the result so downstream applyThinking still sees the suffix (body.model is stripped separately).
  const sufMatch = typeof modelId === "string" ? modelId.match(/\([^()]+\)\s*$/) : null;
  const suffix = sufMatch ? sufMatch[0] : "";
  const baseId = suffix ? modelId.slice(0, sufMatch!.index).trim() : modelId;
  const models = PROVIDER_MODELS[aliasOrId];
  const found = findModel(models, baseId);
  const resolvedId = found?.upstreamModelId || found?.id;
  if (resolvedId) {
    const presetMatch = resolvedId.match(/\([^()]+\)\s*$/);
    const presetSuffix = presetMatch?.[0] || "";
    const resolvedBase = presetSuffix ? resolvedId.slice(0, presetMatch.index).trim() : resolvedId;
    return resolvedBase + (suffix || presetSuffix);
  }
  if (aliasOrId === "cx" && typeof baseId === "string" && baseId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return baseId.slice(0, -CODEX_REVIEW_SUFFIX.length) + suffix;
  }
  return baseId + suffix;
}

export function getModelQuotaFamily(aliasOrId: any, modelId: any) {
  const models = PROVIDER_MODELS[aliasOrId];
  return modelQuotaFamily(findModel(models, modelId));
}

// OAuth short aliases — derived from registry `alias` (single source). everything else: alias = id.
export const OAUTH_ALIASES = Object.fromEntries(
  REGISTRY.filter(r => r.alias && r.alias !== r.id).map(r => [r.id, r.alias])
);

// Derived from PROVIDERS — no need to maintain manually
export const PROVIDER_ID_TO_ALIAS = Object.fromEntries(
  Object.keys(PROVIDERS).map(id => [id, OAUTH_ALIASES[id] || id])
);

export function getModelsByProviderId(providerId: any) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

// Get strip list for a model entry (explicit opt-in only)
// Returns array of content types to strip, e.g. ["image", "audio"]
export function getModelStrip(alias: any, modelId: any) {
  return modelStrip(findModel(PROVIDER_MODELS[alias], modelId));
}
