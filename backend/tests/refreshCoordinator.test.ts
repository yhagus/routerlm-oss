import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

// Many concurrent chat requests on one Connection with an expiring or rejected
// token cause one refresh. Every request uses the result of that refresh.

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-refresh-coordinator-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

type Instance = Awaited<ReturnType<typeof runtime>>;

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

// Claude Code runs on the default executor, so its refresh goes through the
// generic coordinator path. Its refresh lead is 4h: a 1-day expiry is fresh.
const CLAUDE_REFRESH_URL = "https://api.anthropic.com/v1/oauth/token";
const CLAUDE_MODEL = "claude/claude-sonnet-5";
const FRESH_MS = 86_400_000;
const BURST = 20;

const chatRequest = (model: string) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: "hi" }] }),
});

const completion = () => Response.json({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
});

const unauthorized = () => Response.json({ error: { message: "token expired" } }, { status: 401 });

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

function authorization(input: RequestInfo | URL, init?: RequestInit): string {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  return headers.get("authorization") || "";
}

function claudeRefreshResponse(accessToken: string, refreshToken: string) {
  return Response.json({ access_token: accessToken, refresh_token: refreshToken, expires_in: 86_400 });
}

function inFlight(instance: Instance, connectionId: string): number {
  const models = instance.repos.usage.pendingSnapshot().get(connectionId);
  return models ? [...models.values()].reduce((sum, count) => sum + count, 0) : 0;
}

function createClaudeConnection(instance: Instance, expiresInMs: number, refreshToken: string) {
  return instance.repos.providers.create({
    provider: "claude",
    authType: "oauth",
    credentials: { accessToken: "old-access", refreshToken, expiresAt: new Date(Date.now() + expiresInMs).toISOString() },
  });
}

describe("refresh coordinator on the chat request path", () => {
  test("a burst on an expiring token causes one refresh and every request succeeds", async () => {
    const instance = await runtime();
    try {
      const connection = createClaudeConnection(instance, 10_000, `old-refresh-${crypto.randomUUID()}`);
      const releaseRefresh = gate();
      let refreshCalls = 0;
      installFetchMock(async (input, init) => {
        if (requestUrl(input) === CLAUDE_REFRESH_URL) {
          refreshCalls += 1;
          await releaseRefresh.opened;
          return claudeRefreshResponse("new-access", "new-refresh");
        }
        return authorization(input, init).includes("new-access") ? completion() : unauthorized();
      });

      const app = createApp(instance);
      const pending = Array.from({ length: BURST }, () => app.request("/v1/chat/completions", chatRequest(CLAUDE_MODEL)));
      // Hold the refresh until every request is in flight on the Connection.
      await waitFor(() => inFlight(instance, connection.id) === BURST);
      releaseRefresh.open();
      const responses = await Promise.all(pending);

      expect(responses.map((response) => response.status)).toEqual(Array(BURST).fill(200));
      expect(refreshCalls).toBe(1);
      const stored = instance.repos.providers.get(connection.id)!.data;
      expect(stored.accessToken).toBe("new-access");
      expect(stored.refreshToken).toBe("new-refresh");
    } finally {
      instance.close();
    }
  });

  test("a 401 response body is cancelled before the retry with the new token", async () => {
    const instance = await runtime();
    try {
      createClaudeConnection(instance, FRESH_MS, `old-refresh-${crypto.randomUUID()}`);
      let rejectedBodyCancelled = false;
      installFetchMock(async (input, init) => {
        if (requestUrl(input) === CLAUDE_REFRESH_URL) return claudeRefreshResponse("new-access", "new-refresh");
        if (authorization(input, init).includes("new-access")) return completion();
        // A 401 body that never ends unless the reader cancels it.
        const body = new ReadableStream<Uint8Array>({
          pull() { return new Promise(() => {}); },
          cancel() { rejectedBodyCancelled = true; },
        });
        return new Response(body, { status: 401, headers: { "content-type": "application/json" } });
      });

      const response = await createApp(instance).request("/v1/chat/completions", chatRequest(CLAUDE_MODEL));
      expect(response.status).toBe(200);
      expect(rejectedBodyCancelled).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("a burst of 401 responses causes one refresh and each request retries once with the new token", async () => {
    const instance = await runtime();
    try {
      const connection = createClaudeConnection(instance, FRESH_MS, `old-refresh-${crypto.randomUUID()}`);
      const allRejected = gate();
      let oldTokenCalls = 0;
      let newTokenCalls = 0;
      let refreshCalls = 0;
      installFetchMock(async (input, init) => {
        if (requestUrl(input) === CLAUDE_REFRESH_URL) {
          refreshCalls += 1;
          return claudeRefreshResponse("new-access", "new-refresh");
        }
        if (authorization(input, init).includes("new-access")) {
          newTokenCalls += 1;
          return completion();
        }
        // Every request reaches the Provider with the old token before any
        // of them gets its 401.
        oldTokenCalls += 1;
        if (oldTokenCalls === BURST) allRejected.open();
        await allRejected.opened;
        return unauthorized();
      });

      const app = createApp(instance);
      const responses = await Promise.all(Array.from({ length: BURST }, () => app.request("/v1/chat/completions", chatRequest(CLAUDE_MODEL))));

      expect(responses.map((response) => response.status)).toEqual(Array(BURST).fill(200));
      expect(refreshCalls).toBe(1);
      expect(oldTokenCalls).toBe(BURST);
      expect(newTokenCalls).toBe(BURST);
      expect(instance.repos.providers.get(connection.id)!.data.refreshToken).toBe("new-refresh");
    } finally {
      instance.close();
    }
  });

  test("a rotating refresh token is used once per rotation and the newest one is stored", async () => {
    const instance = await runtime();
    try {
      const firstRefreshToken = `rotating-${crypto.randomUUID()}`;
      const connection = createClaudeConnection(instance, 10_000, firstRefreshToken);
      const releaseRefresh = gate();
      // The mock Provider revokes a refresh token when it issues the next one.
      let validRefreshToken = firstRefreshToken;
      let rotation = 0;
      let reusedRefreshTokens = 0;
      let acceptedAccess = "nothing-yet";
      installFetchMock(async (input, init) => {
        if (requestUrl(input) === CLAUDE_REFRESH_URL) {
          await releaseRefresh.opened;
          const sent = JSON.parse(String(init?.body)).refresh_token;
          if (sent !== validRefreshToken) {
            reusedRefreshTokens += 1;
            return Response.json({ error: "invalid_grant" }, { status: 400 });
          }
          rotation += 1;
          validRefreshToken = `${firstRefreshToken}-r${rotation}`;
          acceptedAccess = `access-${rotation}`;
          return claudeRefreshResponse(acceptedAccess, validRefreshToken);
        }
        return authorization(input, init).includes(acceptedAccess) ? completion() : unauthorized();
      });

      const app = createApp(instance);
      const pending = Array.from({ length: BURST }, () => app.request("/v1/chat/completions", chatRequest(CLAUDE_MODEL)));
      await waitFor(() => inFlight(instance, connection.id) === BURST);
      releaseRefresh.open();
      const responses = await Promise.all(pending);

      expect(responses.map((response) => response.status)).toEqual(Array(BURST).fill(200));
      expect(rotation).toBe(1);
      expect(reusedRefreshTokens).toBe(0);
      let stored = instance.repos.providers.get(connection.id)!.data;
      expect(stored.refreshToken).toBe(`${firstRefreshToken}-r1`);
      expect(stored.testStatus).toBe("active");

      // The Provider later rejects the first rotated access token. The next
      // refresh must send the stored, newest refresh token.
      acceptedAccess = "access-2";
      const later = await app.request("/v1/chat/completions", chatRequest(CLAUDE_MODEL));

      expect(later.status).toBe(200);
      expect(rotation).toBe(2);
      expect(reusedRefreshTokens).toBe(0);
      stored = instance.repos.providers.get(connection.id)!.data;
      expect(stored.refreshToken).toBe(`${firstRefreshToken}-r2`);
      expect(stored.accessToken).toBe("access-2");
    } finally {
      instance.close();
    }
  });

  test("codex keeps its credential-manager refresh: a 401 refreshes once and the retry succeeds", async () => {
    const instance = await runtime();
    try {
      const refreshToken = `codex-refresh-${crypto.randomUUID()}`;
      const connection = instance.repos.providers.create({ provider: "codex", authType: "oauth", credentials: { accessToken: "codex-old", refreshToken, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), lastRefreshAt: new Date().toISOString() } });
      let refreshCalls = 0;
      const sse = [
        "data: " + JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "refreshed answer" }),
        "data: " + JSON.stringify({ type: "response.completed", response: { id: "resp_1", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }),
        "data: [DONE]",
      ].join("\n\n");
      installFetchMock(async (input, init) => {
        if (requestUrl(input).includes("/oauth/token")) {
          refreshCalls += 1;
          return Response.json({ access_token: "codex-new", refresh_token: `${refreshToken}-next`, expires_in: 3600 });
        }
        if (authorization(input, init).includes("codex-new")) return new Response(sse, { headers: { "content-type": "text/event-stream" } });
        return unauthorized();
      });

      const response = await createApp(instance).request("/v1/chat/completions", chatRequest("codex/gpt-5.4"));

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("refreshed answer");
      expect(refreshCalls).toBe(1);
      const stored = instance.repos.providers.get(connection.id)!.data;
      expect(stored.accessToken).toBe("codex-new");
      expect(stored.refreshToken).toBe(`${refreshToken}-next`);
    } finally {
      instance.close();
    }
  });
});
