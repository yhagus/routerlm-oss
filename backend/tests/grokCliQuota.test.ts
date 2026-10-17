import { describe, expect, test } from "bun:test";
import { buildGrokCliFreeQuota, parseGrokCliFreeUsageTokens } from "../src/services/billing/usage/grok-cli.ts";
import {
  applyGrokCliFamilyExhaustion,
  clearAllGrokCliFamilyExhaustion,
  clearGrokCliFamilyExhaustion,
  grokCliFamilyProbeModel,
  grokCliFamilyQuotaRows,
  grokCliQuotaFamily,
  hasActiveGrokCliFamilyExhaustion,
  isGrokCliFamilyExhausted,
  isGrokCliFreeUsageExhausted,
  parseGrokCliQuotaFamilyFromError,
  GROK_CLI_FREE_USAGE_BY_FAMILY_KEY,
} from "../src/services/providers/grokCliQuotaFamily.ts";

describe("grokCliQuotaFamily", () => {
  test("maps effort variants to the base family", () => {
    expect(grokCliQuotaFamily("grok-4.6-high")).toBe("grok-4.6");
    expect(grokCliQuotaFamily("grok-4.6-low")).toBe("grok-4.6");
    expect(grokCliQuotaFamily("grok-4.6-medium")).toBe("grok-4.6");
    expect(grokCliQuotaFamily("grok-4.6")).toBe("grok-4.6");
  });

  test("aliases grok-4.5 variants and grok-build to grok-4.6", () => {
    expect(grokCliQuotaFamily("grok-4.5")).toBe("grok-4.6");
    expect(grokCliQuotaFamily("grok-4.5-low")).toBe("grok-4.6");
    expect(grokCliQuotaFamily("grok-4.5-high")).toBe("grok-4.6");
    expect(grokCliQuotaFamily("grok-build")).toBe("grok-4.6");
  });

  test("maps other families to their own base", () => {
    expect(grokCliQuotaFamily("grok-4.7")).toBe("grok-4.7");
    expect(grokCliQuotaFamily("grok-4.7-high")).toBe("grok-4.7");
    expect(grokCliQuotaFamily("grok-4.8-low")).toBe("grok-4.8");
  });

  test("keeps non-pattern models as their own id", () => {
    expect(grokCliQuotaFamily("grok-code-fast-1")).toBe("grok-code-fast-1");
  });

  test("strips provider prefixes", () => {
    expect(grokCliQuotaFamily("gcli/grok-4.7")).toBe("grok-4.7");
    expect(grokCliQuotaFamily("grok-cli/grok-4.5-high")).toBe("grok-4.6");
  });

  test("returns null for empty input", () => {
    expect(grokCliQuotaFamily(null)).toBeNull();
    expect(grokCliQuotaFamily("")).toBeNull();
  });
});

describe("parseGrokCliQuotaFamilyFromError", () => {
  test("extracts family from upstream error text", () => {
    const error = `You've used all the included free usage for model grok-4.6 for now. Usage resets over a rolling 24-hour window — tokens (actual/limit): 564079/1000000.`;
    expect(parseGrokCliQuotaFamilyFromError(error)).toBe("grok-4.6");
  });

  test("aliases grok-4.5 errors to grok-4.6", () => {
    expect(parseGrokCliQuotaFamilyFromError("free usage for model grok-4.5-high exhausted")).toBe("grok-4.6");
  });

  test("returns null when no model is found", () => {
    expect(parseGrokCliQuotaFamilyFromError("some other error")).toBeNull();
    expect(parseGrokCliQuotaFamilyFromError("")).toBeNull();
  });
});

describe("isGrokCliFreeUsageExhausted", () => {
  test("detects 429 with free-usage-exhausted code", () => {
    expect(isGrokCliFreeUsageExhausted("grok-cli", 429, "subscription:free-usage-exhausted")).toBe(true);
  });

  test("detects 402 spending-limit", () => {
    expect(isGrokCliFreeUsageExhausted("grok-cli", 402, "personal-team-blocked:spending-limit")).toBe(true);
    expect(isGrokCliFreeUsageExhausted("grok-cli", 402, "run out of credits")).toBe(true);
  });

  test("rejects non-grok-cli providers", () => {
    expect(isGrokCliFreeUsageExhausted("openai", 429, "subscription:free-usage-exhausted")).toBe(false);
  });

  test("rejects generic 429 without the code", () => {
    expect(isGrokCliFreeUsageExhausted("grok-cli", 429, "rate limit exceeded")).toBe(false);
  });
});

describe("grokCliFamilyProbeModel", () => {
  test("appends -low for base families", () => {
    expect(grokCliFamilyProbeModel("grok-4.6")).toBe("grok-4.6-low");
    expect(grokCliFamilyProbeModel("grok-4.7")).toBe("grok-4.7-low");
  });

  test("returns the id as-is for non-pattern families", () => {
    expect(grokCliFamilyProbeModel("grok-code-fast-1")).toBe("grok-code-fast-1");
  });
});

describe("family exhaustion lifecycle", () => {
  test("applyGrokCliFamilyExhaustion writes 24h reset and clears legacy marker", () => {
    const nowMs = new Date("2026-10-01T12:00:00.000Z").getTime();
    const data = { grokCliFreeUsageExhausted: true, grokCliFreeUsageResetAt: "old" };
    const result = applyGrokCliFamilyExhaustion(data, "grok-4.6", { used: 564079, limit: 1000000 }, nowMs);
    const bag = result[GROK_CLI_FREE_USAGE_BY_FAMILY_KEY] as Record<string, any>;
    expect(bag["grok-4.6"].exhausted).toBe(true);
    expect(bag["grok-4.6"].used).toBe(564079);
    expect(bag["grok-4.6"].limit).toBe(1000000);
    expect(bag["grok-4.6"].resetAt).toBe("2026-10-02T12:00:00.000Z");
    expect(bag["grok-4.6"].exhaustedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(result.grokCliFreeUsageExhausted).toBeNull();
  });

  test("isGrokCliFamilyExhausted returns true within cooldown, false after", () => {
    const data = {
      [GROK_CLI_FREE_USAGE_BY_FAMILY_KEY]: {
        "grok-4.6": { exhausted: true, resetAt: "2026-10-02T12:00:00.000Z" },
      },
    };
    const beforeReset = new Date("2026-10-02T11:59:00.000Z").getTime();
    const afterReset = new Date("2026-10-02T12:01:00.000Z").getTime();
    expect(isGrokCliFamilyExhausted(data, "grok-4.6-high", beforeReset)).toBe(true);
    expect(isGrokCliFamilyExhausted(data, "grok-4.6", afterReset)).toBe(false);
  });

  test("exhausted family 4.6 does not block family 4.7", () => {
    const data = {
      [GROK_CLI_FREE_USAGE_BY_FAMILY_KEY]: {
        "grok-4.6": { exhausted: true, resetAt: "2026-10-02T12:00:00.000Z" },
      },
    };
    const nowMs = new Date("2026-10-01T18:00:00.000Z").getTime();
    expect(isGrokCliFamilyExhausted(data, "grok-4.6", nowMs)).toBe(true);
    expect(isGrokCliFamilyExhausted(data, "grok-4.7", nowMs)).toBe(false);
  });

  test("clearGrokCliFamilyExhaustion removes only the specified family", () => {
    const data = {
      [GROK_CLI_FREE_USAGE_BY_FAMILY_KEY]: {
        "grok-4.6": { exhausted: true, resetAt: "2026-10-02T12:00:00.000Z" },
        "grok-4.7": { exhausted: true, resetAt: "2026-10-03T12:00:00.000Z" },
      },
    };
    const result = clearGrokCliFamilyExhaustion(data, "grok-4.6");
    const bag = result[GROK_CLI_FREE_USAGE_BY_FAMILY_KEY] as Record<string, any>;
    expect(bag["grok-4.6"]).toBeUndefined();
    expect(bag["grok-4.7"]).toBeDefined();
  });

  test("clearAllGrokCliFamilyExhaustion wipes all families", () => {
    const data = {
      [GROK_CLI_FREE_USAGE_BY_FAMILY_KEY]: {
        "grok-4.6": { exhausted: true },
        "grok-4.7": { exhausted: true },
      },
    };
    const result = clearAllGrokCliFamilyExhaustion(data);
    expect(result[GROK_CLI_FREE_USAGE_BY_FAMILY_KEY]).toBeUndefined();
  });

  test("hasActiveGrokCliFamilyExhaustion returns true only within cooldown", () => {
    const data = {
      [GROK_CLI_FREE_USAGE_BY_FAMILY_KEY]: {
        "grok-4.6": { exhausted: true, resetAt: "2026-10-02T12:00:00.000Z" },
      },
    };
    expect(hasActiveGrokCliFamilyExhaustion(data, new Date("2026-10-01T18:00:00.000Z").getTime())).toBe(true);
    expect(hasActiveGrokCliFamilyExhaustion(data, new Date("2026-10-02T13:00:00.000Z").getTime())).toBe(false);
  });

  test("success on family 4.7 does not clear family 4.6", () => {
    const data = {
      [GROK_CLI_FREE_USAGE_BY_FAMILY_KEY]: {
        "grok-4.6": { exhausted: true, resetAt: "2026-10-02T12:00:00.000Z" },
      },
    };
    const result = clearGrokCliFamilyExhaustion(data, "grok-4.7");
    expect(result[GROK_CLI_FREE_USAGE_BY_FAMILY_KEY]).toBeDefined();
    const bag = result[GROK_CLI_FREE_USAGE_BY_FAMILY_KEY] as Record<string, any>;
    expect(bag["grok-4.6"]).toBeDefined();
  });
});

describe("legacy marker compatibility", () => {
  test("legacy grokCliFreeUsageExhausted maps to grok-4.6", () => {
    const data = {
      grokCliFreeUsageExhausted: true,
      grokCliFreeUsageResetAt: "2026-10-02T12:00:00.000Z",
    };
    const nowMs = new Date("2026-10-01T18:00:00.000Z").getTime();
    expect(isGrokCliFamilyExhausted(data, "grok-4.6", nowMs)).toBe(true);
    expect(isGrokCliFamilyExhausted(data, "grok-4.7", nowMs)).toBe(false);
  });

  test("grokCliFamilyQuotaRows includes legacy marker as grok-4.6 row", () => {
    const data = {
      grokCliFreeUsageExhausted: true,
      grokCliFreeUsageResetAt: "2026-10-02T12:00:00.000Z",
      grokCliFreeUsageActualUsed: 564079,
      grokCliFreeUsageActualLimit: 1000000,
    };
    const rows = grokCliFamilyQuotaRows(data, new Date("2026-10-01T18:00:00.000Z").getTime());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.family).toBe("grok-4.6");
    expect(rows[0]?.used).toBe(564079);
    expect(rows[0]?.limit).toBe(1000000);
    expect(rows[0]?.exhausted).toBe(true);
  });
});

describe("Grok CLI free quota", () => {
  test("uses the 1M token limit when upstream has not confirmed a pair", () => {
    const quota = buildGrokCliFreeQuota({ observedTokens: 100000 });
    expect(quota).toEqual({
      used: 100000,
      total: 1000000,
      remainingPercentage: 90,
      resetAt: null,
      unlimited: false,
    });
  });

  test("parses the confirmed actual/limit pair from a free-usage exhaustion error", () => {
    const error = `You've used all the included free usage for model grok-4.6 for now. Usage resets over a rolling 24-hour window — tokens (actual/limit): 564079/1000000. Upgrade to a Grok subscription for higher limits: https://grok.com/supergrok`;
    expect(parseGrokCliFreeUsageTokens(error)).toEqual({ used: 564079, limit: 1000000 });
  });
});
