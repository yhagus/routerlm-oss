import { GROK_CLI_FREE_USAGE_WINDOW_MS } from "./config/grokCli.ts";

export const GROK_CLI_FREE_USAGE_EXHAUSTED_CODE = "subscription:free-usage-exhausted";
export const GROK_CLI_FREE_USAGE_BY_FAMILY_KEY = "grokCliFreeUsageByFamily";
export const GROK_CLI_LEGACY_FAMILY = "grok-4.6";

const FAMILY_ALIASES: Record<string, string> = {
  "grok-build": GROK_CLI_LEGACY_FAMILY,
  "grok-4.5": GROK_CLI_LEGACY_FAMILY,
};

const FAMILY_FROM_MODEL = /^grok-(\d+\.\d+)/i;
const FAMILY_FROM_ERROR = /for\s+model\s+["']?(grok-[A-Za-z0-9._:-]+)/i;

export interface GrokCliFamilyQuota {
  exhausted: boolean;
  used?: number;
  limit?: number;
  resetAt?: string | null;
  exhaustedAt?: string | null;
}

export type GrokCliFamilyQuotaBag = Record<string, GrokCliFamilyQuota>;

export function grokCliQuotaFamily(model: string | null | undefined): string | null {
  const id = String(model || "").trim();
  if (!id) return null;
  const bare = id.replace(/^gcli\//i, "").replace(/^grok-cli\//i, "");
  const alias = FAMILY_ALIASES[bare.toLowerCase()];
  if (alias) return alias;
  const match = FAMILY_FROM_MODEL.exec(bare);
  if (match) {
    const family = `grok-${match[1]}`;
    return FAMILY_ALIASES[family] || family;
  }
  return bare;
}

export function grokCliFamilyQuotaName(family: string): string {
  return family.replace(/^grok-/i, "Grok ");
}

export function grokCliFamilyProbeModel(family: string): string {
  if (/^grok-\d+\.\d+$/i.test(family)) return `${family}-low`;
  return family;
}

export function parseGrokCliQuotaFamilyFromError(errorText: string | null | undefined): string | null {
  const text = String(errorText || "");
  const match = FAMILY_FROM_ERROR.exec(text);
  if (!match) return null;
  return grokCliQuotaFamily(match[1]);
}

export function isGrokCliFreeUsageExhausted(provider: string, status: number, errorText: string): boolean {
  if (provider !== "grok-cli") return false;
  const text = String(errorText || "");
  return (
    (status === 429 && text.includes(GROK_CLI_FREE_USAGE_EXHAUSTED_CODE)) ||
    (status === 402 && /personal-team-blocked:spending-limit|spending limit|run out of credits/i.test(text))
  );
}

function familyBag(data: Record<string, unknown> | null | undefined): GrokCliFamilyQuotaBag {
  const bag = data?.[GROK_CLI_FREE_USAGE_BY_FAMILY_KEY];
  if (!bag || typeof bag !== "object" || Array.isArray(bag)) return {};
  return bag as GrokCliFamilyQuotaBag;
}

function resetMsOf(entry: GrokCliFamilyQuota | null | undefined): number {
  if (!entry?.resetAt) return Number.NaN;
  const resetMs = new Date(String(entry.resetAt)).getTime();
  return Number.isFinite(resetMs) ? resetMs : Number.NaN;
}

export function isGrokCliFamilyExhausted(
  data: Record<string, unknown> | null | undefined,
  model: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!data) return false;
  const family = grokCliQuotaFamily(model);
  if (!family) return false;
  const entry = familyBag(data)[family];
  if (entry?.exhausted === true) {
    const resetMs = resetMsOf(entry);
    return Number.isFinite(resetMs) && nowMs < resetMs;
  }
  if (family === GROK_CLI_LEGACY_FAMILY && data.grokCliFreeUsageExhausted === true) {
    const resetAt = data.grokCliFreeUsageResetAt;
    const resetMs = resetAt ? new Date(String(resetAt)).getTime() : Number.NaN;
    return Number.isFinite(resetMs) && nowMs < resetMs;
  }
  return false;
}

export function grokCliFamilyExhaustedUntil(
  data: Record<string, unknown> | null | undefined,
  model: string | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (!data) return null;
  const family = grokCliQuotaFamily(model);
  if (!family) return null;
  const entry = familyBag(data)[family];
  if (entry?.exhausted === true) {
    const resetMs = resetMsOf(entry);
    return Number.isFinite(resetMs) && nowMs < resetMs ? String(entry.resetAt) : null;
  }
  if (family === GROK_CLI_LEGACY_FAMILY && data.grokCliFreeUsageExhausted === true) {
    const resetAt = data.grokCliFreeUsageResetAt;
    const resetMs = resetAt ? new Date(String(resetAt)).getTime() : Number.NaN;
    return Number.isFinite(resetMs) && nowMs < resetMs ? new Date(String(resetAt)).toISOString() : null;
  }
  return null;
}

export function listGrokCliFamiliesDueForProbe(
  data: Record<string, unknown> | null | undefined,
  nowMs = Date.now(),
): string[] {
  if (!data) return [];
  const due: string[] = [];
  for (const [family, entry] of Object.entries(familyBag(data))) {
    if (entry?.exhausted !== true) continue;
    const resetMs = resetMsOf(entry);
    if (Number.isFinite(resetMs) && nowMs >= resetMs) due.push(family);
  }
  if (data.grokCliFreeUsageExhausted === true && !familyBag(data)[GROK_CLI_LEGACY_FAMILY]) {
    const resetAt = data.grokCliFreeUsageResetAt;
    const resetMs = resetAt ? new Date(String(resetAt)).getTime() : Number.NaN;
    if (!Number.isFinite(resetMs) || nowMs >= resetMs) due.push(GROK_CLI_LEGACY_FAMILY);
  }
  return due;
}

export function applyGrokCliFamilyExhaustion(
  data: Record<string, unknown>,
  family: string,
  tokens: { used: number; limit: number } | null,
  nowMs = Date.now(),
): Record<string, unknown> {
  const exhaustedAt = new Date(nowMs).toISOString();
  const resetAt = new Date(nowMs + GROK_CLI_FREE_USAGE_WINDOW_MS).toISOString();
  const nextBag: GrokCliFamilyQuotaBag = { ...familyBag(data) };
  nextBag[family] = {
    exhausted: true,
    used: tokens?.used,
    limit: tokens?.limit,
    resetAt,
    exhaustedAt,
  };
  const next: Record<string, unknown> = { ...data, [GROK_CLI_FREE_USAGE_BY_FAMILY_KEY]: nextBag };
  if (family === GROK_CLI_LEGACY_FAMILY) {
    next.grokCliFreeUsageExhausted = null;
    next.grokCliFreeUsageResetAt = null;
    next.grokCliFreeUsageResetSource = null;
    next.grokCliFreeUsageNextProbeAt = null;
    next.grokCliFreeUsageActualUsed = null;
    next.grokCliFreeUsageActualLimit = null;
  }
  return next;
}

export function clearGrokCliFamilyExhaustion(
  data: Record<string, unknown>,
  family: string | null | undefined,
): Record<string, unknown> {
  const nextBag: GrokCliFamilyQuotaBag = { ...familyBag(data) };
  if (family && nextBag[family]) delete nextBag[family];
  const next: Record<string, unknown> = { ...data, [GROK_CLI_FREE_USAGE_BY_FAMILY_KEY]: nextBag };
  if (!family || family === GROK_CLI_LEGACY_FAMILY) {
    next.grokCliFreeUsageExhausted = null;
    next.grokCliFreeUsageResetAt = null;
    next.grokCliFreeUsageResetSource = null;
    next.grokCliFreeUsageNextProbeAt = null;
    next.grokCliFreeUsageActualUsed = null;
    next.grokCliFreeUsageActualLimit = null;
  }
  if (Object.keys(nextBag).length === 0) delete next[GROK_CLI_FREE_USAGE_BY_FAMILY_KEY];
  return next;
}

export function clearAllGrokCliFamilyExhaustion(data: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data };
  delete next[GROK_CLI_FREE_USAGE_BY_FAMILY_KEY];
  next.grokCliFreeUsageExhausted = null;
  next.grokCliFreeUsageResetAt = null;
  next.grokCliFreeUsageResetSource = null;
  next.grokCliFreeUsageNextProbeAt = null;
  next.grokCliFreeUsageActualUsed = null;
  next.grokCliFreeUsageActualLimit = null;
  return next;
}

export function hasActiveGrokCliFamilyExhaustion(
  data: Record<string, unknown> | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!data) return false;
  for (const entry of Object.values(familyBag(data))) {
    if (entry?.exhausted !== true) continue;
    const resetMs = resetMsOf(entry);
    if (Number.isFinite(resetMs) && nowMs < resetMs) return true;
  }
  if (data.grokCliFreeUsageExhausted === true) {
    const resetAt = data.grokCliFreeUsageResetAt;
    const resetMs = resetAt ? new Date(String(resetAt)).getTime() : Number.NaN;
    return Number.isFinite(resetMs) && nowMs < resetMs;
  }
  return false;
}

export function hasGrokCliFamilyMarker(
  data: Record<string, unknown> | null | undefined,
  model: string | null | undefined,
): boolean {
  if (!data) return false;
  const family = grokCliQuotaFamily(model);
  if (!family) return false;
  if (familyBag(data)[family]) return true;
  return family === GROK_CLI_LEGACY_FAMILY && data.grokCliFreeUsageExhausted === true;
}

export function grokCliFamilyQuotaRows(
  data: Record<string, unknown> | null | undefined,
  nowMs = Date.now(),
): Array<{ family: string; name: string; used: number; limit: number; resetAt: string | null; exhausted: boolean }> {
  const rows: Array<{ family: string; name: string; used: number; limit: number; resetAt: string | null; exhausted: boolean }> = [];
  const bag = familyBag(data);
  for (const [family, entry] of Object.entries(bag)) {
    const resetMs = resetMsOf(entry);
    const exhausted = entry?.exhausted === true && Number.isFinite(resetMs) && nowMs < resetMs;
    rows.push({
      family,
      name: grokCliFamilyQuotaName(family),
      used: Number(entry?.used) || 0,
      limit: Number(entry?.limit) || 0,
      resetAt: exhausted ? String(entry.resetAt) : null,
      exhausted,
    });
  }
  if (data?.grokCliFreeUsageExhausted === true && !bag[GROK_CLI_LEGACY_FAMILY]) {
    const resetAt = data.grokCliFreeUsageResetAt ? String(data.grokCliFreeUsageResetAt) : null;
    const resetMs = resetAt ? new Date(resetAt).getTime() : Number.NaN;
    const exhausted = Number.isFinite(resetMs) && nowMs < resetMs;
    rows.push({
      family: GROK_CLI_LEGACY_FAMILY,
      name: grokCliFamilyQuotaName(GROK_CLI_LEGACY_FAMILY),
      used: Number(data.grokCliFreeUsageActualUsed) || 0,
      limit: Number(data.grokCliFreeUsageActualLimit) || 0,
      resetAt: exhausted ? resetAt : null,
      exhausted,
    });
  }
  return rows.sort((left, right) => left.family.localeCompare(right.family));
}
