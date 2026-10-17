// Pricing parity with v1.
//
// v2 must resolve model pricing IDENTICALLY to v1. v1's tables
// (open-sse/providers/pricing.js) hold ~97 exact models plus ~60 glob
// patterns and a 3-step lookup chain. Duplicating that table in v2 drifted
// (subset + different values), so this module delegates to the v1 reference
// implementation and keeps only the TS types/signatures v2 callers use.
import * as v1Pricing from "./providerPricing.js";

const {
  MODEL_PRICING: v1MODEL_PRICING,
  PATTERN_PRICING: v1PATTERN_PRICING,
  PROVIDER_PRICING: v1PROVIDER_PRICING,
  getPricingForModel: v1GetPricingForModel,
  calculateCostFromTokens: v1CalculateCostFromTokens,
  formatCost: v1FormatCost,
} = v1Pricing as {
  MODEL_PRICING: Record<string, ModelPricing>;
  PATTERN_PRICING: Array<{ pattern: string; pricing: ModelPricing }>;
  PROVIDER_PRICING: PricingMap;
  getPricingForModel: (provider: string | null, model: string | null) => ModelPricing | null;
  calculateCostFromTokens: (tokens: Record<string, unknown>, pricing: Record<string, unknown>) => number;
  formatCost: (cost: number) => string;
};

export interface ModelPricing {
  input?: number;
  output?: number;
  cached?: number;
  reasoning?: number;
  cache_creation?: number;
}

export type PricingMap = Record<string, Record<string, ModelPricing>>;

// v1 provider-specific defaults (PROVIDER_PRICING) — exactly what
// v1 getDefaultPricing() exposes for the UI / API contract.
export const DEFAULT_PRICING: PricingMap = v1PROVIDER_PRICING as PricingMap;

function clonePricing(value: PricingMap): PricingMap {
  return JSON.parse(JSON.stringify(value)) as PricingMap;
}

export function getDefaultPricing(): PricingMap {
  return clonePricing(DEFAULT_PRICING);
}

// v1 3-step resolution: provider-specific override → exact model → glob
// pattern. This delegates to v1 so pricing never drifts from the reference.
export function resolveDefaultPricing(provider: string | null | undefined, model: string | null | undefined): ModelPricing | null {
  const pricing = v1GetPricingForModel(provider ?? null, model ?? null);
  if (!pricing) return null;
  const result: ModelPricing = {};
  for (const key of Object.keys(pricing) as Array<keyof ModelPricing>) {
    const value = pricing[key];
    if (typeof value === "number") result[key] = value;
  }
  return Object.keys(result).length ? result : null;
}

export function calculateCostFromTokens(tokens: Record<string, unknown>, pricing: ModelPricing): number {
  return v1CalculateCostFromTokens(tokens as Record<string, unknown>, pricing as Record<string, unknown>);
}

export function formatCost(cost: number): string {
  return v1FormatCost(cost);
}

// Exposed for diagnostics / differential testing.
export const MODEL_PRICING: Record<string, ModelPricing> = v1MODEL_PRICING as Record<string, ModelPricing>;
export const PATTERN_PRICING: Array<{ pattern: string; pricing: ModelPricing }> = v1PATTERN_PRICING as Array<{ pattern: string; pricing: ModelPricing }>;
export const PROVIDER_PRICING: PricingMap = v1PROVIDER_PRICING as PricingMap;

export const PRICING_FIELDS = ["input", "output", "cached", "reasoning", "cache_creation"] as const;

export function validatePricing(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Invalid pricing data format";
  for (const [provider, models] of Object.entries(value as Record<string, any>)) {
    if (!models || typeof models !== "object" || Array.isArray(models)) return `Invalid pricing for provider: ${provider}`;
    for (const [model, pricing] of Object.entries(models as Record<string, any>)) {
      if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) return `Invalid pricing for model: ${provider}/${model}`;
      for (const [key, fieldValue] of Object.entries(pricing as Record<string, any>)) {
        if (!(PRICING_FIELDS as readonly string[]).includes(key)) return `Invalid pricing field: ${key} for ${provider}/${model}`;
        if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue) || fieldValue < 0) {
          return `Invalid pricing value for ${key} in ${provider}/${model}: must be non-negative number`;
        }
      }
    }
  }
  return null;
}