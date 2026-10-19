import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { clearAffinity } from "../src/services/chat/sessionAffinity";
import { installFetchMock } from "./fetchHarness";

const CHAT_URL = "https://api.mistral.ai/v1/chat/completions";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-affinity-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => {
  installFetchMock(null);
  clearAffinity();
});

type Instance = Awaited<ReturnType<typeof runtime>>;
type App = ReturnType<typeof createApp>;
type HeldCall = { authorization: string; release: () => void };

// Every upstream call stays in flight until the test releases it.
function holdUpstream() {
  const calls: HeldCall[] = [];
  const waiters: Array<(call: HeldCall) => void> = [];
  installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== CHAT_URL) return new Response("not mocked", { status: 404 });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const call = { authorization: String((init?.headers as Record<string, string>)?.Authorization), release };
    calls.push(call);
    waiters.shift()?.(call);
    await released;
    return Response.json({
      id: "chatcmpl-held",
      object: "chat.completion",
      model: "mistral-large-latest",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  return { calls, nextCall: () => new Promise<HeldCall>((resolve) => { waiters.push(resolve); }) };
}

function chat(app: App, session: string) {
  return app.request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": session },
    body: JSON.stringify({ model: "mistral/mistral-large-latest", messages: [{ role: "user", content: "hi" }] }),
  });
}

// Sends one request, releases it at once, and returns the account key used.
async function served(app: App, upstream: ReturnType<typeof holdUpstream>, session: string): Promise<string> {
  const next = upstream.nextCall();
  const response = chat(app, session);
  const call = await next;
  call.release();
  expect((await response).status).toBe(200);
  return call.authorization;
}

function addConnection(instance: Instance, name: string, apiKey: string, priority: number) {
  return instance.repos.providers.create({ provider: "mistral", authType: "apikey", name, credentials: { apiKey }, priority });
}

async function putConnection(app: App, id: string, body: Record<string, unknown>) {
  const response = await app.request(`/api/providers/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
}

describe("per-account max concurrent", () => {
  test("an account's own limit applies without a provider limit, and clearing it removes the limit", async () => {
    const instance = await runtime();
    try {
      const a = addConnection(instance, "A", "key-a", 1);
      addConnection(instance, "B", "key-b", 2);
      const app = createApp(instance);
      await putConnection(app, a.id, { maxInFlight: 1 });
      expect(instance.repos.providers.get(a.id)?.data.maxInFlight).toBe(1);
      const upstream = holdUpstream();

      const firstCall = upstream.nextCall();
      const first = chat(app, "s1");
      expect((await firstCall).authorization).toBe("Bearer key-a");

      // A is full; B has no limit, so it takes both overflow requests.
      const secondCall = upstream.nextCall();
      const second = chat(app, "s2");
      expect((await secondCall).authorization).toBe("Bearer key-b");
      const thirdCall = upstream.nextCall();
      const third = chat(app, "s3");
      expect((await thirdCall).authorization).toBe("Bearer key-b");

      for (const call of upstream.calls) call.release();
      await Promise.all([first, second, third]);

      await putConnection(app, a.id, { maxInFlight: "" });
      expect(instance.repos.providers.get(a.id)?.data.maxInFlight ?? null).toBeNull();
    } finally {
      instance.close();
    }
  });

  test("an account's own limit overrides the provider default", async () => {
    const instance = await runtime();
    try {
      const a = addConnection(instance, "A", "key-a", 1);
      addConnection(instance, "B", "key-b", 2);
      instance.repos.settings.update({ providerStrategies: { mistral: { maxInFlightPerConnection: 1 } } } as any);
      const app = createApp(instance);
      await putConnection(app, a.id, { maxInFlight: 2 });
      const upstream = holdUpstream();

      const firstCall = upstream.nextCall();
      const first = chat(app, "s1");
      expect((await firstCall).authorization).toBe("Bearer key-a");
      const secondCall = upstream.nextCall();
      const second = chat(app, "s2");
      expect((await secondCall).authorization).toBe("Bearer key-a");
      const thirdCall = upstream.nextCall();
      const third = chat(app, "s3");
      expect((await thirdCall).authorization).toBe("Bearer key-b");

      for (const call of upstream.calls) call.release();
      await Promise.all([first, second, third]);
    } finally {
      instance.close();
    }
  });
});

describe("session affinity", () => {
  test("round-robin places new sessions, and each session keeps its account", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ fallbackStrategy: "round-robin", stickyRoundRobinLimit: 1 } as any);
      addConnection(instance, "A", "key-a", 1);
      addConnection(instance, "B", "key-b", 2);
      const app = createApp(instance);
      const upstream = holdUpstream();

      const s1 = await served(app, upstream, "s1");
      const s2 = await served(app, upstream, "s2");
      expect(s1).not.toBe(s2);
      for (let index = 0; index < 3; index += 1) {
        expect(await served(app, upstream, "s1")).toBe(s1);
        expect(await served(app, upstream, "s2")).toBe(s2);
      }
    } finally {
      instance.close();
    }
  });

  test("a busy home spills one request, then the session returns to its home", async () => {
    const instance = await runtime();
    try {
      const a = addConnection(instance, "A", "key-a", 1);
      addConnection(instance, "B", "key-b", 2);
      const app = createApp(instance);
      await putConnection(app, a.id, { maxInFlight: 1 });
      const upstream = holdUpstream();

      expect(await served(app, upstream, "s1")).toBe("Bearer key-a");

      const heldCall = upstream.nextCall();
      const held = chat(app, "s1");
      expect((await heldCall).authorization).toBe("Bearer key-a");
      expect(await served(app, upstream, "s1")).toBe("Bearer key-b");
      (await heldCall).release();
      expect((await held).status).toBe(200);

      expect(await served(app, upstream, "s1")).toBe("Bearer key-a");
    } finally {
      instance.close();
    }
  });

  test("a locked home moves the session, and it stays on the new account after the lock ends", async () => {
    const instance = await runtime();
    try {
      const a = addConnection(instance, "A", "key-a", 1);
      addConnection(instance, "B", "key-b", 2);
      const app = createApp(instance);
      const upstream = holdUpstream();

      expect(await served(app, upstream, "s1")).toBe("Bearer key-a");
      instance.repos.providers.patch(a.id, { data: { modelLock___all: new Date(Date.now() + 60_000).toISOString() } });
      expect(await served(app, upstream, "s1")).toBe("Bearer key-b");
      instance.repos.providers.patch(a.id, { data: { modelLock___all: null } });
      expect(await served(app, upstream, "s1")).toBe("Bearer key-b");
      // A new session still starts on the fill-first account.
      expect(await served(app, upstream, "s2")).toBe("Bearer key-a");
    } finally {
      instance.close();
    }
  });

  test("turning affinity off for the provider restores per-request round-robin", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({
        fallbackStrategy: "round-robin",
        stickyRoundRobinLimit: 1,
        providerStrategies: { mistral: { sessionAffinity: false } },
      } as any);
      addConnection(instance, "A", "key-a", 1);
      addConnection(instance, "B", "key-b", 2);
      const app = createApp(instance);
      const upstream = holdUpstream();

      const first = await served(app, upstream, "s1");
      const second = await served(app, upstream, "s1");
      expect(first).not.toBe(second);
    } finally {
      instance.close();
    }
  });
});
