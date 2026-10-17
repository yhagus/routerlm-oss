import { describe, expect, test } from "bun:test";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import {
  codebuddyExhaustedExcludedModels,
  selectChatConnection,
} from "../src/services/chat/credentials";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-codebuddy-excl-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

function seedAccount(instance: Awaited<ReturnType<typeof runtime>>, data: Record<string, unknown> = {}) {
  return instance.repos.providers.create({
    provider: "codebuddy-intl-cli",
    authType: "oauth",
    name: "acct",
    email: `acct-${crypto.randomUUID()}@example.com`,
    credentials: { accessToken: "tok" },
    data,
  });
}

describe("codebuddy-intl-cli exhausted excluded models", () => {
  test("reads the configured exclusion list fail-safe", async () => {
    const instance = await runtime();
    try {
      expect(codebuddyExhaustedExcludedModels(instance).size).toBe(0);
      instance.repos.settings.update({
        codebuddyIntlCli: { exhaustedExcludedModels: ["deepseek-v4.1-flash", "  "] },
      });
      const excluded = codebuddyExhaustedExcludedModels(instance);
      expect(excluded.has("deepseek-v4.1-flash")).toBe(true);
      expect(excluded.size).toBe(1);
    } finally {
      instance.close();
    }
  });

  test("account-wide lock blocks every model, except the excluded model", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({
        codebuddyIntlCli: { exhaustedExcludedModels: ["deepseek-v4.1-flash"] },
      });
      const account = seedAccount(instance, {
        modelLock___all: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      // A non-excluded model must skip the locked account.
      expect(selectChatConnection(instance, "codebuddy-intl-cli", { model: "glm-5.2" }).selected).toBeNull();

      // The excluded model bypasses the account-wide lock and is served.
      const selection = selectChatConnection(instance, "codebuddy-intl-cli", { model: "deepseek-v4.1-flash" });
      expect(selection.selected?.connection.id).toBe(account.id);
    } finally {
      instance.close();
    }
  });

  test("excluded model's own lock stays independent and does not lock siblings", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({
        codebuddyIntlCli: { exhaustedExcludedModels: ["deepseek-v4.1-flash"] },
      });
      const account = seedAccount(instance, {
        "modelLock_deepseek-v4.1-flash": new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      // The exhausted excluded model skips the account…
      expect(selectChatConnection(instance, "codebuddy-intl-cli", { model: "deepseek-v4.1-flash" }).selected).toBeNull();

      // …but sibling models are unaffected.
      const selection = selectChatConnection(instance, "codebuddy-intl-cli", { model: "glm-5.2" });
      expect(selection.selected?.connection.id).toBe(account.id);
    } finally {
      instance.close();
    }
  });

  test("expired account-wide lock no longer blocks selection", async () => {
    const instance = await runtime();
    try {
      const account = seedAccount(instance, {
        modelLock___all: new Date(Date.now() - 60 * 1000).toISOString(),
      });
      const selection = selectChatConnection(instance, "codebuddy-intl-cli", { model: "glm-5.2" });
      expect(selection.selected?.connection.id).toBe(account.id);
    } finally {
      instance.close();
    }
  });
});
