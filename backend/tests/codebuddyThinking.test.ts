import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { applyCodebuddyReasoningSummary } from "../src/services/chat/codebuddyThinking";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-codebuddy-thinking-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => {
  installFetchMock(null);
});

describe("applyCodebuddyReasoningSummary", () => {
  test("injects auto for codebuddy providers on plain bodies (CLI default)", () => {
    const body = { model: "m", messages: [] };
    expect(applyCodebuddyReasoningSummary(body, "codebuddy-intl-cli", null)).toMatchObject({ reasoning_summary: "auto" });
  });

  test("leaves non-codebuddy providers untouched", () => {
    const body = { model: "m", messages: [] };
    expect(applyCodebuddyReasoningSummary(body, "openai", null)).toBe(body);
  });

  test("keeps an explicitly set reasoning_summary", () => {
    const body = { model: "m", reasoning_summary: "detailed" };
    expect(applyCodebuddyReasoningSummary(body, "codebuddy-intl-cli", null)).toBe(body);
  });

  test("respects explicit thinking opt-outs", () => {
    expect(applyCodebuddyReasoningSummary({ model: "m" }, "codebuddy-intl-cli", { mode: "off" })).toEqual({ model: "m" });
    expect(applyCodebuddyReasoningSummary({ model: "m", reasoning_effort: "none" }, "codebuddy-intl-cli", null)).toEqual({
      model: "m",
      reasoning_effort: "none",
    });
    expect(applyCodebuddyReasoningSummary({ model: "m", reasoning_effort: "off" }, "codebuddy-intl-cli", null)).toEqual({
      model: "m",
      reasoning_effort: "off",
    });
  });

  test("injects alongside an explicit effort (vendor mirrors the same pair)", () => {
    expect(applyCodebuddyReasoningSummary({ model: "m", reasoning_effort: "high" }, "codebuddy-intl-cli", null)).toMatchObject({
      reasoning_effort: "high",
      reasoning_summary: "auto",
    });
  });
});

describe("codebuddy chat dispatch carries the CLI wire default", () => {
  test("upstream body includes reasoning_summary auto", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({
        provider: "codebuddy-intl-cli",
        authType: "apikey",
        credentials: { apiKey: "cb-key" },
      });
      let capturedBody: Record<string, any> | null = null;
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("codebuddy.ai/v2/chat/completions") && init?.method === "POST") {
          capturedBody = JSON.parse(String(init.body)) as Record<string, any>;
          return new Response(`data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n`, { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "codebuddy-intl-cli/glm-5.2", stream: false, messages: [{ role: "user", content: "hi" }] }),
      });
      expect(response.status).toBe(200);
      expect(capturedBody).toMatchObject({ reasoning_summary: "auto", stream: true });
    } finally {
      instance.close();
    }
  });
});
