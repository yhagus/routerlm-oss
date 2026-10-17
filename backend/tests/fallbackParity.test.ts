import { describe, expect, test } from "bun:test";
import { checkFallbackError, getUnavailableUntil, getQuotaCooldown, isAccountUnavailable } from "../src/services/chat/accountFallback.js";
import { fallbackState, unavailableUntil, isConnectionUnavailable } from "../src/services/chat/fallback";
import type { ProviderConnection } from "../src/db/repositories";

// v1 reference values from open-sse/config/errorConfig.js.
const BACKOFF_BASE = 2000;
const BACKOFF_MAX = 5 * 60 * 1000;
const TRANSIENT = 30 * 1000;
const LONG = 2 * 60 * 1000;

describe("fallback parity (v2 fallbackState vs v1 checkFallbackError)", () => {
  const cases: Array<{ name: string; status: number; message: string; level: number }> = [
    { name: "429 rate limit level 0", status: 429, message: "Rate limit exceeded", level: 0 },
    { name: "429 rate limit level 3", status: 429, message: "Rate limit exceeded", level: 3 },
    { name: "rate limit text", status: 500, message: "rate limit hit upstream", level: 1 },
    { name: "overloaded text (missing in old v2)", status: 500, message: "server overloaded", level: 0 },
    { name: "quota exceeded text", status: 400, message: "You exceeded your current quota", level: 2 },
    { name: "capacity text", status: 500, message: "insufficient capacity", level: 0 },
    { name: "401 auth (long cooldown in v1)", status: 401, message: "Invalid API key", level: 0 },
    { name: "402 payment (long cooldown in v1)", status: 402, message: "Payment required", level: 0 },
    { name: "403 forbidden (long cooldown in v1)", status: 403, message: "forbidden", level: 0 },
    { name: "404 not found (long cooldown in v1)", status: 404, message: "model not found", level: 0 },
    { name: "no credentials text", status: 500, message: "no credentials found", level: 0 },
    { name: "unmatched transient", status: 500, message: "some weird error", level: 0 },
  ];

  test("fallbackState matches v1 checkFallbackError for every case", () => {
    for (const { name, status, message, level } of cases) {
      const v1 = checkFallbackError(status, message, level);
      const v2 = fallbackState(status, message, level);
      expect(v2.cooldownMs, `${name}: cooldownMs`).toBe(v1.cooldownMs!);
      expect(v2.backoffLevel, `${name}: backoffLevel`).toBe(v1.newBackoffLevel ?? level);
    }
  });

  test("rate-limit backoff uses v1 curve (base 2s, cap 5 min, 15 levels)", () => {
    // Level 1 → 2s (v1 base), not the old v2 1s.
    expect(fallbackState(429, "rate limit", 0).cooldownMs).toBe(BACKOFF_BASE);
    // Level 3 → 2 * 2^2 = 8s.
    expect(fallbackState(429, "rate limit", 2).cooldownMs).toBe(BACKOFF_BASE * 4);
    // High levels cap at 5 minutes (v1), not 4 minutes (old v2).
    expect(fallbackState(429, "rate limit", 14).cooldownMs).toBe(BACKOFF_MAX);
    expect(getQuotaCooldown(15)).toBe(BACKOFF_MAX);
  });

  test("transient and long cooldowns use v1 durations", () => {
    expect(fallbackState(500, "weird failure", 0).cooldownMs).toBe(TRANSIENT);
    expect(fallbackState(401, "bad key", 0).cooldownMs).toBe(LONG);
  });

  test("unavailableUntil and isConnectionUnavailable match v1", () => {
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      expect(unavailableUntil(5000)).toBe(getUnavailableUntil(5000));
      const future = new Date(Date.now() + 60_000).toISOString();
      const past = new Date(Date.now() - 60_000).toISOString();
      const connection = { data: { rateLimitedUntil: future } } as unknown as ProviderConnection;
      expect(isConnectionUnavailable(connection)).toBe(true);
      expect(isAccountUnavailable(future)).toBe(true);
      expect(isConnectionUnavailable({ data: { rateLimitedUntil: past } } as unknown as ProviderConnection)).toBe(false);
      expect(isConnectionUnavailable({ data: {} } as unknown as ProviderConnection)).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });
});
