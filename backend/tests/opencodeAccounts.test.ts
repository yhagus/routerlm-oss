import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { selectChatConnection } from "../src/services/chat/credentials";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-opencode-accounts-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

describe("opencode optional accounts", () => {
  test("uses saved accounts first and falls back to the public connection", async () => {
    const instance = await runtime();
    try {
      expect(selectChatConnection(instance, "opencode").selected?.connection.id).toBe("noauth");

      const account = instance.repos.providers.create({ provider: "opencode", authType: "apikey", name: "paid", apiKey: "oc-key" });
      expect(selectChatConnection(instance, "opencode", { model: "gpt-5" }).selected?.connection.id).toBe(account.id);
      // Picking "Public" in the playground keeps the public connection.
      expect(selectChatConnection(instance, "opencode", { preferredId: "noauth" }).selected?.connection.id).toBe("noauth");
      // After every account fails in this request, the public connection still serves.
      expect(selectChatConnection(instance, "opencode", { excludeIds: new Set([account.id]) }).selected?.connection.id).toBe("noauth");
      expect(selectChatConnection(instance, "opencode", { excludeIds: new Set([account.id, "noauth"]) }).selected).toBeNull();

      instance.repos.providers.update(account.id, { isActive: false });
      expect(selectChatConnection(instance, "opencode").selected?.connection.id).toBe("noauth");
    } finally {
      instance.close();
    }
  });

  test("requires an API key to save an account", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const post = (body: Record<string, unknown>) =>
        app.request("/api/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect((await post({ provider: "opencode", name: "empty" })).status).toBe(400);
      expect((await post({ provider: "opencode", name: "paid", apiKey: "oc-key" })).status).toBeLessThan(300);
    } finally {
      instance.close();
    }
  });
});
