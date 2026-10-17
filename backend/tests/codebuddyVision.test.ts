import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-codebuddy-vision-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

function captureUpstream() {
  let captured: Record<string, any> | null = null;
  installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("codebuddy.ai/v2/chat/completions") && init?.method === "POST") {
      captured = JSON.parse(String(init.body)) as Record<string, any>;
      return new Response(`data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n`, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
  return () => captured;
}

const IMAGE_BODY = {
  model: "cbai-cli/my-vision-model",
  stream: false,
  messages: [
    { role: "user", content: [{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
  ],
};

afterEach(() => installFetchMock(null));

describe("codebuddy-intl-cli custom vision model keeps images", () => {
  test("an override with vision:true lets the image reach upstream", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({
        provider: "codebuddy-intl-cli",
        authType: "apikey",
        credentials: { apiKey: "cb-key" },
      });
      // Mirror the dashboard: add a custom model + its capability override.
      instance.repos.models.upsert({ id: "my-vision-model", providerAlias: "cbai-cli", provider: "cbai-cli", model: "my-vision-model", kind: "llm" });
      instance.sqlite.query("INSERT INTO kv(scope, key, value) VALUES ('modelCapabilityOverrides', ?, ?)").run("cbai-cli/my-vision-model", JSON.stringify({ vision: true }));

      const getCaptured = captureUpstream();
      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(IMAGE_BODY),
      });
      expect(response.status).toBe(200);
      const content = getCaptured()?.messages?.[1]?.content;
      expect(Array.isArray(content)).toBe(true);
      expect(content.some((block: any) => block.type === "image_url")).toBe(true);
      expect(JSON.stringify(content)).not.toContain("image omitted");
    } finally {
      instance.close();
    }
  });

  test("without an override the image is stripped (text-only floor)", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({
        provider: "codebuddy-intl-cli",
        authType: "apikey",
        credentials: { apiKey: "cb-key" },
      });
      instance.repos.models.upsert({ id: "plain-model", providerAlias: "cbai-cli", provider: "cbai-cli", model: "plain-model", kind: "llm" });

      const getCaptured = captureUpstream();
      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...IMAGE_BODY, model: "cbai-cli/plain-model" }),
      });
      expect(response.status).toBe(200);
      const content = getCaptured()?.messages?.[1]?.content;
      expect(JSON.stringify(content)).toContain("image omitted");
    } finally {
      instance.close();
    }
  });

  test("built-in codebuddy vision model keeps images without any override", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({
        provider: "codebuddy-intl-cli",
        authType: "apikey",
        credentials: { apiKey: "cb-key" },
      });
      const getCaptured = captureUpstream();
      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...IMAGE_BODY, model: "cbai-cli/glm-5v-turbo" }),
      });
      expect(response.status).toBe(200);
      const content = getCaptured()?.messages?.[1]?.content;
      expect(content.some((block: any) => block.type === "image_url")).toBe(true);
      expect(JSON.stringify(content)).not.toContain("image omitted");
    } finally {
      instance.close();
    }
  });

  test("a custom model's stored capabilities (no kv override) also keeps images", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({
        provider: "codebuddy-intl-cli",
        authType: "apikey",
        credentials: { apiKey: "cb-key" },
      });
      // Only the models row carries capabilities; no kv override is written.
      instance.repos.models.upsert({
        id: "row-only-model",
        providerAlias: "cbai-cli",
        provider: "cbai-cli",
        model: "row-only-model",
        kind: "llm",
        capabilities: { vision: true },
      });

      const getCaptured = captureUpstream();
      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...IMAGE_BODY, model: "cbai-cli/row-only-model" }),
      });
      expect(response.status).toBe(200);
      const content = getCaptured()?.messages?.[1]?.content;
      expect(content.some((block: any) => block.type === "image_url")).toBe(true);
      expect(JSON.stringify(content)).not.toContain("image omitted");
    } finally {
      instance.close();
    }
  });
});
