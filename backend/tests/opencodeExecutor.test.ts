import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-opencode-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

function chatRequest(model: string) {
  return new Request("http://local/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], stream: false }),
  });
}

interface CapturedCall { url: string; init?: RequestInit }

function header(init: RequestInit | undefined, name: string): string | undefined {
  const h = init?.headers;
  if (h instanceof Headers) return h.get(name) ?? undefined;
  const obj = h as Record<string, string> | undefined;
  if (!obj) return undefined;
  return obj[name] ?? obj[name.toLowerCase()] ?? obj[Object.keys(obj).find(k => k.toLowerCase() === name.toLowerCase()) ?? ""];
}

describe("opencode executor family routing", () => {
  test("routes each family to its native /inference endpoint with free-tier headers", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "opencode", authType: "none" });
      const calls: CapturedCall[] = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        const url = String(input);
        if (url.endsWith("/inference/v1/models")) {
          return Response.json({ object: "list", data: [] });
        }
        return Response.json({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: {} });
      });
      const app = createApp(instance);

      // Free models go through the free-tier gate path.
      const cases: Array<[string, string]> = [
        ["oc/muse-spark-1.3-contributor-free", "/inference/openai/v1/responses"],
        ["oc/gpt-5.6-sol-free", "/inference/openai/v1/responses"],
        ["oc/claude-haiku-4-5-free", "/inference/anthropic/v1/messages"],
        ["oc/qwen3.7-max-free", "/inference/anthropic/v1/messages"],
        ["oc/gemini-3.8-flash-free", "/inference/google/v1beta/models/gemini-3.8-flash-free"],
        ["oc/deepseek-v4.1-flash-free", "/inference/openai/v1/chat/completions"],
      ];
      for (const [model, suffix] of cases) {
        const before = calls.length;
        await app.request("/v1/chat/completions", chatRequest(model));
        const chatCall = [...calls].reverse().find((c) => c.url.includes("opencode.ai/inference"))!;
        const url = chatCall.url;
        expect(url.endsWith(suffix)).toBe(true);
        expect(url.startsWith("https://opencode.ai")).toBe(true);
        // Free-tier headers
        expect(header(chatCall.init, "Authorization")).toBe("Bearer public");
        expect(header(chatCall.init, "x-opencode-client")).toBe("cli");
        expect(header(chatCall.init, "x-opencode-project")).toBe("global");
        expect(header(chatCall.init, "x-opencode-session")).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
        expect(header(chatCall.init, "x-opencode-session-id")).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
        // Must NOT send x-opencode-request (the /inference gate rejects it)
        expect(header(chatCall.init, "x-opencode-request")).toBeUndefined();
        expect(header(chatCall.init, "User-Agent")).toBe("opencode/latest/2.0.29/cli");
        expect(calls.length).toBeGreaterThan(before);
      }
    } finally {
      instance.close();
    }
  });

  test("free chat body includes the core agent toolset and stream:true", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "opencode", authType: "none" });
      const calls: CapturedCall[] = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return Response.json({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: {} });
      });
      const app = createApp(instance);

      await app.request("/v1/chat/completions", chatRequest("oc/deepseek-v4.1-flash-free"));
      const chatCall = [...calls].reverse().find((c) => c.url.includes("/inference/openai/v1/chat/completions"))!;
      const body = JSON.parse(chatCall.init!.body as string);
      expect(body.stream).toBe(true);
      expect(body.stream_options?.include_usage).toBe(true);
      const toolNames = (body.tools || []).map((t: any) => t.function?.name).filter(Boolean);
      for (const name of ["shell", "edit", "glob", "grep", "read"]) {
        expect(toolNames).toContain(name);
      }
    } finally {
      instance.close();
    }
  });
});
