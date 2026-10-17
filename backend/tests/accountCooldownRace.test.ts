import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-cooldown-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

type Instance = Awaited<ReturnType<typeof runtime>>;

function chat(instance: Instance, model: string) {
  return createApp(instance).request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: `mistral/${model}`, stream: false, messages: [{ role: "user", content: "hi" }] }),
  });
}

const rateLimited = () => Response.json({ error: { message: "rate limited" } }, { status: 429 });

describe("account cooldown after a slow failed request", () => {
  test("a slow 429 does not lower the backoff level that faster 429s raised", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "k" } });
      let releaseSlow!: () => void;
      const slowReleased = new Promise<void>((resolve) => { releaseSlow = resolve; });
      let slowStarted!: () => void;
      const slowSeen = new Promise<void>((resolve) => { slowStarted = resolve; });
      installFetchMock(async (_input, init) => {
        const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
        if (body.model === "mistral-large-latest") {
          slowStarted();
          await slowReleased;
        }
        return rateLimited();
      });

      // Request A is selected at backoff level 0 and waits on the Provider.
      const slow = chat(instance, "mistral-large-latest");
      await slowSeen;
      // Two other models fail fast on the same Connection: level 0 -> 1 -> 2.
      expect((await chat(instance, "mistral-small-latest")).status).toBe(429);
      expect((await chat(instance, "codestral-latest")).status).toBe(429);
      expect(instance.repos.providers.get(connection.id)?.data.backoffLevel).toBe(2);

      releaseSlow();
      expect((await slow).status).toBe(429);

      // A started at level 0, but the stored level is 2: A raises it to 3.
      expect(instance.repos.providers.get(connection.id)?.data.backoffLevel).toBe(3);
    } finally {
      instance.close();
    }
  });

  test("a slow failure with a short cooldown keeps a longer model lock that was stored meanwhile", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "k" } });
      let releaseSlow!: () => void;
      const slowReleased = new Promise<void>((resolve) => { releaseSlow = resolve; });
      let slowStarted!: () => void;
      const slowSeen = new Promise<void>((resolve) => { slowStarted = resolve; });
      installFetchMock(async () => {
        slowStarted();
        await slowReleased;
        return rateLimited();
      });

      const slow = chat(instance, "mistral-large-latest");
      await slowSeen;
      // Another writer stores a lock on the same model that ends in one hour.
      const longLock = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      instance.repos.providers.patch(connection.id, { data: { "modelLock_mistral-large-latest": longLock } });

      releaseSlow();
      expect((await slow).status).toBe(429);

      expect(instance.repos.providers.get(connection.id)?.data["modelLock_mistral-large-latest"]).toBe(longLock);
    } finally {
      instance.close();
    }
  });
});
