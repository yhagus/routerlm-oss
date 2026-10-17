// Fallback parity with v1.
//
// v2 must classify upstream errors and compute cooldowns IDENTICALLY to v1.
// v1's rules live in open-sse/config/errorConfig.js (ERROR_RULES,
// BACKOFF_CONFIG, TRANSIENT_COOLDOWN_MS) and open-sse/services/accountFallback.js.
// Duplicating them here drifted (wrong base/cap/levels, missing status rules
// for 401-404, missing text rules like "overloaded"), so this module delegates
// to the v1 reference implementation and keeps only the v2 call signatures.
import * as v1Fallback from "./accountFallback.js";
import type { ProviderConnection, Repositories } from "../../db/repositories";

const {
  checkFallbackError: v1CheckFallbackError,
  getUnavailableUntil: v1GetUnavailableUntil,
  isAccountUnavailable: v1IsAccountUnavailable,
} = v1Fallback as {
  checkFallbackError: (status: number, errorText: string, backoffLevel?: number) => { shouldFallback: boolean; cooldownMs: number; newBackoffLevel?: number };
  getUnavailableUntil: (cooldownMs: number) => string;
  isAccountUnavailable: (unavailableUntil: string | null | undefined) => boolean;
};

export function isConnectionUnavailable(connection: ProviderConnection): boolean {
  return v1IsAccountUnavailable(typeof connection.data.rateLimitedUntil === "string" ? connection.data.rateLimitedUntil : null);
}

// v1 checkFallbackError semantics: ERROR_RULES text rules first (no
// credentials, request not allowed, rate limit, too many requests,
// quota exceeded, capacity, overloaded...), then status rules (401/402/403/404
// → 2-min cooldown, 429 → exponential backoff base 2s / cap 5 min / level 15),
// default 30s transient. Returns the v2-shaped {cooldownMs, backoffLevel}.
export function fallbackState(status: number, message: string, currentLevel = 0): { cooldownMs: number; backoffLevel: number } {
  const result = v1CheckFallbackError(status, message || "", currentLevel);
  return { cooldownMs: result.cooldownMs, backoffLevel: result.newBackoffLevel ?? currentLevel };
}

export function unavailableUntil(cooldownMs: number): string {
  return v1GetUnavailableUntil(cooldownMs);
}

// The stored row at write time. Error paths read it after the upstream await,
// because another request may have raised the backoff level or stored a
// longer lock while this request waited on the Provider.
export function storedConnection(repos: Pick<Repositories, "providers">, connection: ProviderConnection): ProviderConnection {
  return repos.providers.get(connection.id) ?? connection;
}

export function currentBackoffLevel(repos: Pick<Repositories, "providers">, connection: ProviderConnection): number {
  return Number(storedConnection(repos, connection).data.backoffLevel || 0);
}

// The later of a stored lock end and a new lock end. A short cooldown never
// cuts a longer lock that another request stored.
export function laterUntil(stored: unknown, next: string): string {
  const storedMs = typeof stored === "string" ? new Date(stored).getTime() : NaN;
  return Number.isFinite(storedMs) && storedMs > new Date(next).getTime() ? String(stored) : next;
}

export function errorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, any>;
    return String(parsed.error?.message || parsed.message || body || `HTTP ${status}`);
  } catch {
    return body || `HTTP ${status}`;
  }
}