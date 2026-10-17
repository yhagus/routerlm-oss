import { afterEach, describe, expect, test } from "bun:test";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";
import { isCodebuddyPriorityMeterExhaustedButOthersRemain, selectChatConnection } from "../src/services/chat/credentials";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-codebuddy-prio-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

function seedSnapshot(
  instance: Awaited<ReturnType<typeof runtime>>,
  connectionId: string,
  quotas: Record<string, { used: number; total: number; unlimited?: boolean }>,
) {
  instance.repos.quotaSnapshots.upsert({
    connectionId,
    provider: "codebuddy-intl-cli",
    payload: { quotas },
    status: "ready",
    fetchedAt: new Date().toISOString(),
    expiresAt: null,
    nextRefreshAt: new Date(Date.now() + 60_000).toISOString(),
    lastError: null,
    failureCount: 0,
  });
}

const originalFetch = globalThis.fetch;
afterEach(() => { installFetchMock(null); globalThis.fetch = originalFetch; });

describe("codebuddy-intl-cli priority meter", () => {
  test("isCodebuddyPriorityMeterExhaustedButOthersRemain fires only when priority is empty and another meter has balance", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codebuddy-intl-cli", authType: "oauth", name: "acct", email: "one@example.com",
        credentials: { accessToken: "tok-one" },
      });
      // Priority empty + bonus remains → true.
      seedSnapshot(instance, conn.id, {
        Monthly: { used: 100, total: 100 },
        "Bonus Pack 1": { used: 0, total: 250 },
      });
      expect(isCodebuddyPriorityMeterExhaustedButOthersRemain(instance, conn.id, "Monthly")).toBe(true);

      // Priority still has balance → false.
      seedSnapshot(instance, conn.id, {
        Monthly: { used: 5, total: 100 },
        "Bonus Pack 1": { used: 0, total: 250 },
      });
      expect(isCodebuddyPriorityMeterExhaustedButOthersRemain(instance, conn.id, "Monthly")).toBe(false);

      // Priority empty AND every other meter also empty → false (nothing to fall back to).
      seedSnapshot(instance, conn.id, {
        Monthly: { used: 100, total: 100 },
        "Bonus Pack 1": { used: 250, total: 250 },
      });
      expect(isCodebuddyPriorityMeterExhaustedButOthersRemain(instance, conn.id, "Monthly")).toBe(false);

      // Priority meter absent entirely → fail-open (no false skip).
      seedSnapshot(instance, conn.id, {
        "Bonus Pack 1": { used: 0, total: 250 },
      });
      expect(isCodebuddyPriorityMeterExhaustedButOthersRemain(instance, conn.id, "Monthly")).toBe(false);
    } finally {
      instance.close();
    }
  });

  test("fail-open on missing snapshot", async () => {
    const instance = await runtime();
    try {
      const conn = instance.repos.providers.create({
        provider: "codebuddy-intl-cli", authType: "oauth", name: "fresh", email: "fresh@example.com",
        credentials: { accessToken: "tok-fresh" },
      });
      expect(isCodebuddyPriorityMeterExhaustedButOthersRemain(instance, conn.id, "Monthly")).toBe(false);
    } finally {
      instance.close();
    }
  });

  test("selectChatConnection skips the account that already drained the priority meter when another account still has it", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ codebuddyIntlCli: { priorityMeter: "Monthly" } });
      const drained = instance.repos.providers.create({
        provider: "codebuddy-intl-cli", authType: "oauth", name: "drained", email: "drained@example.com",
        credentials: { accessToken: "tok-drained" },
      });
      const fresh = instance.repos.providers.create({
        provider: "codebuddy-intl-cli", authType: "oauth", name: "fresh", email: "fresh@example.com",
        credentials: { accessToken: "tok-fresh" },
      });
      seedSnapshot(instance, drained.id, {
        Monthly: { used: 100, total: 100 },
        "Bonus Pack 1": { used: 0, total: 250 },
      });
      seedSnapshot(instance, fresh.id, {
        Monthly: { used: 5, total: 100 },
        "Bonus Pack 1": { used: 0, total: 250 },
      });

      const selection = selectChatConnection(instance, "codebuddy-intl-cli");
      expect(selection.selected?.connection.id).toBe(fresh.id);
    } finally {
      instance.close();
    }
  });

  test("falls back to the drained-monthly account when every eligible account has already drained Monthly", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ codebuddyIntlCli: { priorityMeter: "Monthly" } });
      const a = instance.repos.providers.create({
        provider: "codebuddy-intl-cli", authType: "oauth", name: "a", email: "a@example.com",
        credentials: { accessToken: "tok-a" },
      });
      const b = instance.repos.providers.create({
        provider: "codebuddy-intl-cli", authType: "oauth", name: "b", email: "b@example.com",
        credentials: { accessToken: "tok-b" },
      });
      // Both accounts have Monthly exhausted but Bonus Pack still available.
      seedSnapshot(instance, a.id, {
        Monthly: { used: 100, total: 100 },
        "Bonus Pack 1": { used: 0, total: 250 },
      });
      seedSnapshot(instance, b.id, {
        Monthly: { used: 100, total: 100 },
        "Bonus Pack 1": { used: 0, total: 250 },
      });

      // Strict phase returns 0 candidates → fallback engages, first-priority
      // account wins.
      const selection = selectChatConnection(instance, "codebuddy-intl-cli");
      expect(selection.selected).not.toBeNull();
      expect([a.id, b.id]).toContain(selection.selected!.connection.id);
    } finally {
      instance.close();
    }
  });

  test("feature is a no-op when settings.codebuddyIntlCli.priorityMeter is null", async () => {
    const instance = await runtime();
    try {
      const drained = instance.repos.providers.create({
        provider: "codebuddy-intl-cli", authType: "oauth", name: "drained", email: "drained@example.com",
        credentials: { accessToken: "tok-drained" },
      });
      const fresh = instance.repos.providers.create({
        provider: "codebuddy-intl-cli", authType: "oauth", name: "fresh", email: "fresh@example.com",
        credentials: { accessToken: "tok-fresh" },
      });
      seedSnapshot(instance, drained.id, {
        Monthly: { used: 100, total: 100 },
        "Bonus Pack 1": { used: 0, total: 250 },
      });
      seedSnapshot(instance, fresh.id, {
        Monthly: { used: 5, total: 100 },
        "Bonus Pack 1": { used: 0, total: 250 },
      });

      // No setting → priority filter off → first-priority account picked
      // regardless of Monthly balance.
      const selection = selectChatConnection(instance, "codebuddy-intl-cli");
      expect(selection.selected?.connection.id).toBe(drained.id);
    } finally {
      instance.close();
    }
  });
});
