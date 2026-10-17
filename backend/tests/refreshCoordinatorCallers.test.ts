import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { runTokenRefreshTick } from "../src/services/billing/tokenRefreshScheduler";
import { installFetchMock } from "./fetchHarness";

// The background token refresh scheduler and the media endpoints share the
// refresh coordinator with the chat request path. When they see the same
// expiring Connection at the same time, the Provider gets one refresh.

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-refresh-callers-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { open, opened };
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

// Gives a second caller time to reach the Provider refresh endpoint if it
// does not join the refresh that is already in flight.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

function authorization(input: RequestInfo | URL, init?: RequestInit): string {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  return headers.get("authorization") || "";
}

const chatRequest = (model: string) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: "hi" }] }),
});

const unauthorized = () => Response.json({ error: { message: "token expired" } }, { status: 401 });

describe("refresh coordinator callers", () => {
  test("a scheduler tick and a chat request on one expiring token cause one refresh", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "claude",
        authType: "oauth",
        credentials: { accessToken: "old-access", refreshToken: "old-refresh", expiresAt: new Date(Date.now() + 10_000).toISOString() },
      });
      const releaseRefresh = gate();
      let refreshCalls = 0;
      installFetchMock(async (input, init) => {
        if (requestUrl(input) === "https://api.anthropic.com/v1/oauth/token") {
          refreshCalls += 1;
          await releaseRefresh.opened;
          return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 86_400 });
        }
        if (!authorization(input, init).includes("new-access")) return unauthorized();
        return Response.json({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      });

      const chat = createApp(instance).request("/v1/chat/completions", chatRequest("claude/claude-sonnet-5"));
      await waitFor(() => refreshCalls === 1);
      const tick = runTokenRefreshTick(instance);
      await settle();
      releaseRefresh.open();
      const [response] = await Promise.all([chat, tick]);

      expect(response.status).toBe(200);
      expect(refreshCalls).toBe(1);
      const stored = instance.repos.providers.get(connection.id)!.data;
      expect(stored.accessToken).toBe("new-access");
      expect(stored.refreshToken).toBe("new-refresh");
    } finally {
      instance.close();
    }
  });

  test("an image request and a chat request on one expiring token cause one refresh", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "codex",
        authType: "oauth",
        credentials: { accessToken: "codex-old", refreshToken: "codex-refresh", expiresAt: new Date(Date.now() + 10_000).toISOString(), lastRefreshAt: new Date().toISOString() },
      });
      const releaseRefresh = gate();
      let refreshCalls = 0;
      let rejectedImageCalls = 0;
      const chatSse = [
        "data: " + JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "chat answer" }),
        "data: " + JSON.stringify({ type: "response.completed", response: { id: "resp_1", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }),
        "data: [DONE]",
        "",
      ].join("\n\n");
      const imageSse = "event: response.output_item.done\ndata: " + JSON.stringify({ item: { type: "image_generation_call", result: "aW1hZ2U=" } }) + "\n\n";
      installFetchMock(async (input, init) => {
        if (requestUrl(input).includes("/oauth/token")) {
          refreshCalls += 1;
          await releaseRefresh.opened;
          return Response.json({ access_token: "codex-new", refresh_token: "codex-refresh-next", expires_in: 3600 });
        }
        const isImage = String(init?.body ?? "").includes("image_generation");
        if (!authorization(input, init).includes("codex-new")) {
          if (isImage) rejectedImageCalls += 1;
          return unauthorized();
        }
        return new Response(isImage ? imageSse : chatSse, { headers: { "content-type": "text/event-stream" } });
      });

      const app = createApp(instance);
      const chat = app.request("/v1/chat/completions", chatRequest("codex/gpt-5.4"));
      await waitFor(() => refreshCalls === 1);
      // The image request still sends the old token and gets a 401 while the
      // chat refresh is in flight.
      const image = app.request("/v1/images/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "codex/gpt-5.5-image", prompt: "a cat" }),
      });
      await waitFor(() => rejectedImageCalls === 1);
      await settle();
      releaseRefresh.open();
      const [chatResponse, imageResponse] = await Promise.all([chat, image]);

      expect(chatResponse.status).toBe(200);
      expect(await chatResponse.text()).toContain("chat answer");
      expect(imageResponse.status).toBe(200);
      expect((await imageResponse.json() as any).data[0].b64_json).toBe("aW1hZ2U=");
      expect(refreshCalls).toBe(1);
      const stored = instance.repos.providers.get(connection.id)!.data;
      expect(stored.accessToken).toBe("codex-new");
      expect(stored.refreshToken).toBe("codex-refresh-next");
    } finally {
      instance.close();
    }
  });
  test("a Codex reset-credits read and a chat request on one expiring token cause one refresh", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "codex",
        authType: "oauth",
        credentials: { accessToken: "credits-old", refreshToken: "credits-refresh", expiresAt: new Date(Date.now() + 10_000).toISOString(), lastRefreshAt: new Date().toISOString() },
      });
      const releaseRefresh = gate();
      let refreshCalls = 0;
      const chatSse = [
        "data: " + JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "chat answer" }),
        "data: " + JSON.stringify({ type: "response.completed", response: { id: "resp_1", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }),
        "data: [DONE]",
        "",
      ].join("\n\n");
      installFetchMock(async (input, init) => {
        const url = requestUrl(input);
        if (url.includes("/oauth/token")) {
          refreshCalls += 1;
          await releaseRefresh.opened;
          return Response.json({ access_token: "credits-new", refresh_token: "credits-refresh-next", expires_in: 3600 });
        }
        if (!authorization(input, init).includes("credits-new")) return unauthorized();
        if (url.includes("rate-limit-reset-credits")) return Response.json({ available_count: 2, credits: [] });
        return new Response(chatSse, { headers: { "content-type": "text/event-stream" } });
      });

      const app = createApp(instance);
      const chat = app.request("/v1/chat/completions", chatRequest("codex/gpt-5.4"));
      await waitFor(() => refreshCalls === 1);
      const credits = app.request(`/api/usage/${connection.id}/codex-reset-credits`);
      await settle();
      releaseRefresh.open();
      const [chatResponse, creditsResponse] = await Promise.all([chat, credits]);

      expect(chatResponse.status).toBe(200);
      expect(creditsResponse.status).toBe(200);
      expect((await creditsResponse.json() as any).availableCount).toBe(2);
      expect(refreshCalls).toBe(1);
      const stored = instance.repos.providers.get(connection.id)!.data;
      expect(stored.accessToken).toBe("credits-new");
      expect(stored.refreshToken).toBe("credits-refresh-next");
    } finally {
      instance.close();
    }
  });
});
