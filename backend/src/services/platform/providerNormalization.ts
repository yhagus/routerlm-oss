import { AI_PROVIDERS } from "./shared/constants/providers.ts";

/**
 * Detect xAI Grok models by id pattern (grok-*, Grok_*, etc).
 * @param {string} modelId
 * @returns {boolean}
 */
export function isXaiModel(modelId: any) {
  return typeof modelId === "string" && /^grok[-_]/i.test(modelId.trim());
}

export function normalizeProviderId(provider: any) {
  if (typeof provider !== "string") return provider;

  const trimmed = provider.trim();
  if ((AI_PROVIDERS as any)[trimmed]) return trimmed;

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if ((AI_PROVIDERS as any)[slug]) return slug;

  const providerByName = Object.values(AI_PROVIDERS).find(
    (entry) => (entry as any).name?.toLowerCase() === trimmed.toLowerCase()
  );
  return (providerByName as any)?.id || trimmed;
}

export function normalizeProviderSpecificData(provider: any, body: any = {}, providerSpecificData: any = null) {
  const next = providerSpecificData && typeof providerSpecificData === "object"
    ? { ...providerSpecificData }
    : {};

  return Object.keys(next).length > 0 ? next : null;
}
