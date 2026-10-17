import { afterEach, describe, expect, test } from "bun:test";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";
import { isCodexModelAllowedForPlan, selectChatConnection } from "../src/services/chat/credentials";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-codex-free-blocked-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

const originalFetch = globalThis.fetch;
afterEach(() => { installFetchMock(null); globalThis.fetch = originalFetch; });

function seedPlan(
  instance: Awaited<ReturnType<typeof runtime>>,
  connectionId: string,
  plan: string,
) {
  instance.repos.quotaSnapshots.upsert({
    connectionId,
    provider: "codex",
    payload: { plan },
    status: "ready",
    fetchedAt: new Date().toISOString(),
    expiresAt: null,
    nextRefreshAt: new Date(Date.now() + 60_000).toISOString(),
    lastError: null,
    failureCount: 0,
  });
}

describe("codex free-blocked-models (legacy)", () => {
  test("blocks gpt-5.6-sol for free-plan accounts by default", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "free-acct", email: "free@example.com",
        credentials: { accessToken: "tok-free" },
      });
      seedPlan(instance, conn.id, "free");
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.6-sol")).toBe(false);
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.6-sol-review")).toBe(false);
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.5")).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("does not block flagship models for plus-plan accounts", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "plus-acct", email: "plus@example.com",
        credentials: { accessToken: "tok-plus" },
      });
      seedPlan(instance, conn.id, "plus");
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.6-sol")).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("operator can add a new model id via settings without a code change", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "free-acct", email: "free@example.com",
        credentials: { accessToken: "tok-free" },
      });
      seedPlan(instance, conn.id, "free");
      // Initially not blocked.
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.7-aurora")).toBe(true);
      // Operator adds the new flagship model to the blocklist.
      instance.repos.settings.update({
        codex: { freeBlockedModels: ["gpt-5.6-sol", "gpt-5.6-sol-review", "gpt-5.7-aurora"] },
      });
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.7-aurora")).toBe(false);
      // Strip the provider prefix before matching.
      expect(isCodexModelAllowedForPlan(instance, conn, "codex/gpt-5.7-aurora")).toBe(false);
    } finally {
      instance.close();
    }
  });

  test("operator can clear the blocklist to disable the feature", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "free-acct", email: "free@example.com",
        credentials: { accessToken: "tok-free" },
      });
      seedPlan(instance, conn.id, "free");
      instance.repos.settings.update({ codex: { freeBlockedModels: [] } });
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.6-sol")).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("falls back to hardcoded defaults when settings are malformed", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "free-acct", email: "free@example.com",
        credentials: { accessToken: "tok-free" },
      });
      seedPlan(instance, conn.id, "free");
      // Malformed setting: not an array.
      instance.repos.settings.update({ codex: { freeBlockedModels: "gpt-5.6-sol" } });
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.6-sol")).toBe(false);
    } finally {
      instance.close();
    }
  });

  test("selectChatConnection skips free-plan accounts for blocked flagship models", async () => {
    const instance = await runtime();
    try {
      const freeConn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "free-acct", email: "free@example.com",
        credentials: { accessToken: "tok-free" },
      });
      const plusConn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "plus-acct", email: "plus@example.com",
        credentials: { accessToken: "tok-plus" },
      });
      seedPlan(instance, freeConn.id, "free");
      seedPlan(instance, plusConn.id, "plus");
      const selection = selectChatConnection(instance, "codex", { model: "gpt-5.6-sol" });
      expect(selection.selected?.connection.id).toBe(plusConn.id);
    } finally {
      instance.close();
    }
  });
});

describe("codex plan-model-map (allowlist)", () => {
  test("planModelMap restricts free plan to allowlisted models", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "free-acct", email: "free@example.com",
        credentials: { accessToken: "tok-free" },
      });
      seedPlan(instance, conn.id, "free");
      instance.repos.settings.update({
        codex: {
          planModelMap: {
            free: ["gpt-5.6-terra", "gpt-6-luna"],
            plus: ["gpt-6-sol", "gpt-5.6-sol", "gpt-6-astra"],
          },
        },
      });
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.6-terra")).toBe(true);
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-6-luna")).toBe(true);
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-6-sol")).toBe(false);
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.6-sol")).toBe(false);
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-6-astra")).toBe(false);
    } finally {
      instance.close();
    }
  });

  test("planModelMap restricts plus plan to its allowlisted models", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "plus-acct", email: "plus@example.com",
        credentials: { accessToken: "tok-plus" },
      });
      seedPlan(instance, conn.id, "plus");
      instance.repos.settings.update({
        codex: {
          planModelMap: {
            free: ["gpt-5.6-terra"],
            plus: ["gpt-6-sol", "gpt-5.6-sol"],
          },
        },
      });
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-6-sol")).toBe(true);
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.6-sol")).toBe(true);
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.6-terra")).toBe(false);
    } finally {
      instance.close();
    }
  });

  test("unknown plan is allowed all models even when planModelMap is set", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "team-acct", email: "team@example.com",
        credentials: { accessToken: "tok-team" },
      });
      seedPlan(instance, conn.id, "team");
      instance.repos.settings.update({
        codex: {
          planModelMap: {
            free: ["gpt-5.6-terra"],
          },
        },
      });
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-6-sol")).toBe(true);
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.6-terra")).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("no plan (null) is allowed all models", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "unknown-acct", email: "unknown@example.com",
        credentials: { accessToken: "tok-unknown" },
      });
      // No quota snapshot seeded — plan resolves to null.
      instance.repos.settings.update({
        codex: {
          planModelMap: {
            free: ["gpt-5.6-terra"],
          },
        },
      });
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-6-sol")).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("planModelMap takes precedence over legacy freeBlockedModels", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "free-acct", email: "free@example.com",
        credentials: { accessToken: "tok-free" },
      });
      seedPlan(instance, conn.id, "free");
      // Set both: planModelMap should win.
      instance.repos.settings.update({
        codex: {
          freeBlockedModels: ["gpt-6-sol"],
          planModelMap: { free: ["gpt-5.6-terra"] },
        },
      });
      // planModelMap allowlist mode: gpt-5.6-terra is allowed, gpt-6-sol is NOT
      // in the free allowlist (even though it's in freeBlockedModels).
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-5.6-terra")).toBe(true);
      expect(isCodexModelAllowedForPlan(instance, conn, "gpt-6-sol")).toBe(false);
    } finally {
      instance.close();
    }
  });

  test("model id matching strips provider prefix", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "free-acct", email: "free@example.com",
        credentials: { accessToken: "tok-free" },
      });
      seedPlan(instance, conn.id, "free");
      instance.repos.settings.update({
        codex: {
          planModelMap: { free: ["gpt-5.6-terra"] },
        },
      });
      expect(isCodexModelAllowedForPlan(instance, conn, "codex/gpt-5.6-terra")).toBe(true);
      expect(isCodexModelAllowedForPlan(instance, conn, "codex/gpt-6-sol")).toBe(false);
    } finally {
      instance.close();
    }
  });

  test("selectChatConnection picks the correct account by plan allowlist", async () => {
    const instance = await runtime();
    try {
      const freeConn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "free-acct", email: "free@example.com",
        credentials: { accessToken: "tok-free" },
      });
      const plusConn = instance.repos.providers.create({
        provider: "codex", authType: "oauth", name: "plus-acct", email: "plus@example.com",
        credentials: { accessToken: "tok-plus" },
      });
      seedPlan(instance, freeConn.id, "free");
      seedPlan(instance, plusConn.id, "plus");
      instance.repos.settings.update({
        codex: {
          planModelMap: {
            free: ["gpt-5.6-terra"],
            plus: ["gpt-6-sol", "gpt-5.6-sol"],
          },
        },
      });
      // Requesting a plus-only model should skip the free account.
      const selection = selectChatConnection(instance, "codex", { model: "gpt-6-sol" });
      expect(selection.selected?.connection.id).toBe(plusConn.id);
      // Requesting a free-allowed model should pick the free account (first).
      const freeSelection = selectChatConnection(instance, "codex", { model: "gpt-5.6-terra" });
      expect(freeSelection.selected?.connection.id).toBe(freeConn.id);
    } finally {
      instance.close();
    }
  });
});
