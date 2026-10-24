import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-codebuddy-webchat-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

function codebuddyCliConnection(instance: Awaited<ReturnType<typeof runtime>>) {
  return instance.repos.providers.create({
    provider: "codebuddy-intl-cli",
    authType: "oauth",
    name: "CodeBuddy CLI Account",
    credentials: {},
    data: { accessToken: "at-1", refreshToken: "rt-1", codebuddyUserId: "uid-1" },
  });
}

function sseBody(id: string, content: string): string {
  return [
    `data: ${JSON.stringify({ id, choices: [{ delta: { content } }] })}\n`,
    "data: [DONE]\n",
  ].join("");
}

afterEach(() => {
  installFetchMock(null);
});

describe("codebuddy webchat", () => {
  test("run creates a conversation and streams a real chat", async () => {
    const instance = await runtime();
    try {
      const connection = codebuddyCliConnection(instance);
      const app = createApp(instance);
      const calls: string[] = [];
      let capturedConv: unknown = null;
      let capturedChat: unknown = null;

      let capturedReport: unknown = null;
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method || "GET"} ${url}`);
        if (url.includes("/console/webchat/conversations") && init?.method === "POST") {
          capturedConv = JSON.parse(String(init.body));
          return new Response(JSON.stringify({ data: { conversationId: "conv-real-1" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/console/chat/completions") && init?.method === "POST") {
          capturedChat = JSON.parse(String(init.body));
          return new Response(sseBody("cmb-0123456789abcdef0123456789abcdef", "hello"), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        if (url.includes("/v2/report") && init?.method === "POST") {
          capturedReport = JSON.parse(String(init.body));
          return new Response("{}", { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

      const run = await app.request(`/api/usage/codebuddy-webchat/${connection.id}`, { method: "POST" });
      expect(run.status).toBe(200);
      const payload = await run.json();
      expect(payload).toMatchObject({
        ok: true,
        connectionId: connection.id,
        conversationId: "conv-real-1",
        messageId: "cmb-0123456789abcdef0123456789abcdef",
        reply: "hello",
        reported: true,
      });
      expect(capturedConv).toEqual(expect.objectContaining({ name: expect.stringMatching(/^webchat-/) }));
      expect(capturedChat).toMatchObject({
        model: "glm-5.2",
        stream: true,
        conversationId: "conv-real-1",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "hi" },
        ],
      });
      expect(Array.isArray(capturedReport)).toBe(true);
      expect((capturedReport as Array<Record<string, unknown>>)[0]).toMatchObject({
        eventCode: "agent_task_created",
        conversationId: "conv-real-1",
        messageId: "cmb-0123456789abcdef0123456789abcdef",
        requestId: "cmb-0123456789abcdef0123456789abcdef",
      });
      expect(calls.some((line) => line.includes("/console/webchat/conversations"))).toBe(true);
      expect(calls.some((line) => line.includes("/console/chat/completions"))).toBe(true);
      expect(calls.some((line) => line.includes("/v2/report"))).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("run rejects non-codebuddy-intl-cli connections", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "qoder",
        authType: "oauth",
        credentials: { accessToken: "at-1" },
      });
      const app = createApp(instance);
      const response = await app.request(`/api/usage/codebuddy-webchat/${connection.id}`, { method: "POST" });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("CodeBuddy intl CLI") });
    } finally {
      instance.close();
    }
  });

  test("run surfaces conversation create errors", async () => {
    const instance = await runtime();
    try {
      const connection = codebuddyCliConnection(instance);
      const app = createApp(instance);
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/console/webchat/conversations") && init?.method === "POST") {
          return new Response(JSON.stringify({ msg: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        return new Response("not found", { status: 404 });
      });
      const run = await app.request(`/api/usage/codebuddy-webchat/${connection.id}`, { method: "POST" });
      expect(run.status).toBe(400);
      const payload = await run.json();
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("401");
    } finally {
      instance.close();
    }
  });
});
