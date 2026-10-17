import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";
import { clearAccountError, clearConnectionLocks, markAccountUnavailable, selectChatConnection } from "../src/services/chat/credentials";
import { extractUpstreamErrorCode, parseUpstreamError } from "../src/services/common/error";
import { alimsExhaustedMarkerKey, isAlimsFreeTierExhausted } from "../src/services/providers/alimsFreeTier";

const FREE_TIER_BODY = JSON.stringify({
  error: {
    message: "The free quota has been exhausted.",
    type: "AllocationQuota.FreeTierOnly",
    code: "AllocationQuota.FreeTierOnly",
  },
});

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-alims-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

const originalFetch = globalThis.fetch;
afterEach(() => { installFetchMock(null); globalThis.fetch = originalFetch; });

describe("alims-intl free-tier exhaustion", () => {
  test("extractUpstreamErrorCode reads error.code and error.type", () => {
    expect(extractUpstreamErrorCode(FREE_TIER_BODY)).toBe("AllocationQuota.FreeTierOnly");
    expect(extractUpstreamErrorCode(JSON.stringify({ error: { type: "Other.Code" } }))).toBe("Other.Code");
    expect(extractUpstreamErrorCode("not json")).toBeNull();
    expect(extractUpstreamErrorCode("")).toBeNull();
  });

  test("parseUpstreamError surfaces the provider code alongside the message", async () => {
    const response = new Response(FREE_TIER_BODY, { status: 403, headers: { "content-type": "application/json" } });
    const parsed = await parseUpstreamError(response);
    expect(parsed.statusCode).toBe(403);
    expect(parsed.code).toBe("AllocationQuota.FreeTierOnly");
  });

  test("isAlimsFreeTierExhausted requires provider, 403, and the exact code", () => {
    expect(isAlimsFreeTierExhausted("alims-intl", 403, "AllocationQuota.FreeTierOnly")).toBe(true);
    expect(isAlimsFreeTierExhausted("alims-intl", 403, "Other.Code")).toBe(false);
    expect(isAlimsFreeTierExhausted("alims-intl", 429, "AllocationQuota.FreeTierOnly")).toBe(false);
    expect(isAlimsFreeTierExhausted("glm", 403, "AllocationQuota.FreeTierOnly")).toBe(false);
  });

  test("markAccountUnavailable persists the marker and selection skips that model", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "alims-intl", authType: "apikey", name: "Key One", credentials: { apiKey: "sk-one" } });
      const marked = await markAccountUnavailable(
        instance, connection, 403, FREE_TIER_BODY, "alims-intl", "glm-5", null, false, "AllocationQuota.FreeTierOnly",
      );
      expect(marked).toBe(true);
      const stored = instance.repos.providers.get(connection.id)!;
      expect(stored.data[alimsExhaustedMarkerKey("glm-5")]).toBe(true);

      // The exhausted model is skipped; an untried model still selects.
      expect(selectChatConnection(instance, "alims-intl", { model: "glm-5" }).selected).toBeNull();
      expect(selectChatConnection(instance, "alims-intl", { model: "kimi-k2.5" }).selected).not.toBeNull();
    } finally {
      instance.close();
    }
  });

  test("a successful call clears the marker", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "alims-intl", authType: "apikey", name: "Key One", credentials: { apiKey: "sk-one" } });
      await markAccountUnavailable(instance, connection, 403, FREE_TIER_BODY, "alims-intl", "glm-5", null, false, "AllocationQuota.FreeTierOnly");
      clearAccountError(instance, connection, "glm-5");
      const stored = instance.repos.providers.get(connection.id)!;
      expect(stored.data[alimsExhaustedMarkerKey("glm-5")]).toBeFalsy();
      expect(selectChatConnection(instance, "alims-intl", { model: "glm-5" }).selected).not.toBeNull();
    } finally {
      instance.close();
    }
  });

  test("availability endpoint reports available vs exhausted per model and resets", async () => {
    const instance = await runtime();
    try {
      const one = instance.repos.providers.create({ provider: "alims-intl", authType: "apikey", name: "Key One", credentials: { apiKey: "sk-one" } });
      instance.repos.providers.create({ provider: "alims-intl", authType: "apikey", name: "Key Two", credentials: { apiKey: "sk-two" } });
      await markAccountUnavailable(instance, one, 403, FREE_TIER_BODY, "alims-intl", "glm-5", null, false, "AllocationQuota.FreeTierOnly");
      const app = createApp(instance);

      const payload = await (await app.request("/api/providers/alims-intl/model-availability")).json();
      expect(payload.totalAccounts).toBe(2);
      const glm = payload.models.find((model: { id: string }) => model.id === "glm-5");
      expect(glm).toMatchObject({ total: 2, exhausted: 1, available: 1 });
      const other = payload.models.find((model: { id: string }) => model.id === "kimi-k2.5");
      expect(other).toMatchObject({ total: 2, exhausted: 0, available: 2 });

      const reset = await app.request("/api/providers/alims-intl/model-availability/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "glm-5" }),
      });
      expect(await reset.json()).toMatchObject({ ok: true, reset: 1, model: "glm-5" });
      expect(instance.repos.providers.get(one.id)!.data[alimsExhaustedMarkerKey("glm-5")]).toBeFalsy();
    } finally {
      instance.close();
    }
  });

  test("manual lock reset also clears the free-tier marker", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "alims-intl", authType: "apikey", name: "Key One", credentials: { apiKey: "sk-one" } });
      await markAccountUnavailable(instance, connection, 403, FREE_TIER_BODY, "alims-intl", "glm-5", null, false, "AllocationQuota.FreeTierOnly");
      clearConnectionLocks(instance, connection.id);
      expect(instance.repos.providers.get(connection.id)!.data[alimsExhaustedMarkerKey("glm-5")]).toBeFalsy();
    } finally {
      instance.close();
    }
  });
});
