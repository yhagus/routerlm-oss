import type { ProviderConnection } from "../../db/repositories";

export interface NormalizedQuota {
  id: string;
  name: string;
  used: number | null;
  total: number | null;
  remaining: number | null;
  resetAt: string | null;
  unlimited: boolean;
}

export interface ConnectionQuota {
  id: string;
  provider: string;
  name: string;
  email: string | null;
  isActive: boolean;
  authType: string;
  quotas: NormalizedQuota[];
  plan: string | null;
  message: string | null;
  error: string | null;
  fetchedAt: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeQuota(name: string, value: unknown, index: number): NormalizedQuota {
  const source = record(value);
  const total = numeric(source.total ?? source.limit ?? source.max ?? source.capacity);
  const used = numeric(source.used ?? source.utilization ?? source.usedPercentage ?? source.percentUsed);
  const explicitRemaining = numeric(source.remaining ?? source.remainingPercentage ?? source.remaining_percent ?? source.percentRemaining);
  const remaining = explicitRemaining ?? (total !== null && used !== null ? Math.max(0, total - used) : used !== null && used <= 100 ? Math.max(0, 100 - used) : null);
  return {
    id: String(source.id ?? source.model ?? source.name ?? `${name}-${index}`),
    name: String(source.name ?? name),
    used,
    total,
    remaining,
    resetAt: timestamp(source.resetAt ?? source.resetsAt ?? source.resets_at ?? source.reset_at ?? source.nextResetAt),
    unlimited: source.unlimited === true || total === null,
  };
}

export function normalizeProviderQuota(payload: unknown): { quotas: NormalizedQuota[]; plan: string | null; message: string | null } {
  const source = record(payload);
  const rawQuotas = source.quotas ?? source.limits ?? source.usage;
  const entries = Array.isArray(rawQuotas)
    ? rawQuotas.map((value, index) => [String(record(value).name ?? record(value).model ?? `Quota ${index + 1}`), value] as const)
    : Object.entries(record(rawQuotas));
  return {
    quotas: entries.map(([name, value], index) => normalizeQuota(name, value, index)),
    plan: typeof source.plan === "string" ? source.plan : null,
    message: typeof source.message === "string" ? source.message : null,
  };
}

export function isQuotaEligible(connection: ProviderConnection): boolean {
  const apiKey = connection.authType === "apikey" || connection.authType === "api_key";
  return connection.authType === "oauth" || (apiKey && ["glm", "glm-cn", "deepseek"].includes(connection.provider));
}
