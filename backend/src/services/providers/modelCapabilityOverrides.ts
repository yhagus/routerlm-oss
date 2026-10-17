import type { Runtime } from "../../runtime";

export const MODEL_CAPABILITY_SCOPE = "modelCapabilityOverrides";

export const EDITABLE_CAPABILITY_KEYS = [
  "vision",
  "reasoning",
  "search",
  "audioInput",
  "imageOutput",
] as const;

export type EditableCapabilityKey = (typeof EDITABLE_CAPABILITY_KEYS)[number];
export type CapabilityOverride = Partial<Record<EditableCapabilityKey, boolean>>;

export function normalizeCapabilityOverride(value: unknown): CapabilityOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const out: CapabilityOverride = {};
  for (const key of EDITABLE_CAPABILITY_KEYS) {
    if (typeof source[key] === "boolean") out[key] = source[key];
  }
  return Object.keys(out).length ? out : null;
}

export function parseStoredOverride(value: unknown): CapabilityOverride | null {
  if (typeof value !== "string") return normalizeCapabilityOverride(value);
  try {
    return normalizeCapabilityOverride(JSON.parse(value));
  } catch {
    return null;
  }
}

export function loadCapabilityOverrides(sqlite: {
  query(sql: string): { all(...params: unknown[]): unknown[] };
}): Record<string, CapabilityOverride> {
  const rows = sqlite
    .query("SELECT key, value FROM kv WHERE scope = ?")
    .all(MODEL_CAPABILITY_SCOPE) as Array<{ key: string; value: string }>;
  const out: Record<string, CapabilityOverride> = {};
  for (const row of rows) {
    const override = parseStoredOverride(row.value);
    if (override) out[row.key] = override;
  }
  return out;
}

export function capabilityOverrideFor(
  runtime: Pick<Runtime, "sqlite">,
  provider: string,
  model: string,
): CapabilityOverride | null {
  if (!provider || !model) return null;
  // The dashboard writes vision (etc.) two ways: the kv override (read here
  // first) and the custom `models` row's capabilities column. Custom models
  // imported or added without the kv write would otherwise fall back to the
  // text-only floor and have their images stripped, so read the row as a
  // fallback.
  const row = runtime.sqlite
    .query("SELECT value FROM kv WHERE scope = ? AND key = ?")
    .get(MODEL_CAPABILITY_SCOPE, `${provider}/${model}`) as { value?: string } | null;
  const stored = row ? parseStoredOverride(row.value) : null;
  if (stored) return stored;
  const custom = runtime.sqlite
    .query("SELECT capabilities FROM models WHERE source = 'custom' AND providerAlias = ? AND modelId = ?")
    .get(provider, model) as { capabilities?: string } | null;
  return custom ? parseStoredOverride(custom.capabilities) : null;
}

export function applyCapabilityOverride<T extends Record<string, unknown>>(
  caps: T,
  override: CapabilityOverride | null | undefined,
): T {
  if (!override) return caps;
  return { ...caps, ...override };
}
