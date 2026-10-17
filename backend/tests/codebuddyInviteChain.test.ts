import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-codebuddy-invite-chain-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

function cliConnection(instance: Awaited<ReturnType<typeof runtime>>) {
  return instance.repos.providers.create({
    provider: "codebuddy-intl-cli",
    authType: "oauth",
    name: "CodeBuddy CLI Account",
    credentials: {},
    data: { accessToken: "at-1", refreshToken: "rt-1", codebuddyUserId: "uid-1" },
  });
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function sseOk(id: string, content: string): Response {
  const body = `data: ${JSON.stringify({ id, choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

interface Counters {
  webchatConv: number;
  webchatChat: number;
  report: number;
  checkin: number;
  bind: number;
}

function chainMocks(counters: Counters, opts: { checkinFail?: boolean } = {}) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/console/webchat/conversations") && init?.method === "POST") {
      counters.webchatConv += 1;
      return jsonOk({ data: { conversationId: "conv-1" } });
    }
    if (url.includes("/console/chat/completions") && init?.method === "POST") {
      counters.webchatChat += 1;
      return sseOk("cmb-0123456789abcdef0123456789abcdef", "hello");
    }
    if (url.includes("/v2/report") && init?.method === "POST") {
      counters.report += 1;
      return new Response("{}", { status: 200 });
    }
    if (url.includes("checkin-activity-status") && init?.method === "POST") {
      counters.checkin += 1;
      if (opts.checkinFail) return new Response("quota exceeded", { status: 429 });
      return jsonOk({ code: 0, data: { today_checked_in: true, active: true, streak_days: 1 } });
    }
    if (url.includes("/invitation/v2/bind") && init?.method === "POST") {
      counters.bind += 1;
      return jsonOk({ code: 0, msg: "ok" });
    }
    return new Response("not found", { status: 404 });
  };
}

afterEach(() => installFetchMock(null));

describe("codebuddy invite chain", () => {
  test("runs webchat → probe → bind and stores done state", async () => {
    const instance = await runtime();
    try {
      const connection = cliConnection(instance);
      const app = createApp(instance);
      const counters: Counters = { webchatConv: 0, webchatChat: 0, report: 0, checkin: 0, bind: 0 };
      installFetchMock(chainMocks(counters));

      const run = await app.request(`/api/usage/codebuddy-invite/${connection.id}/chain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "INV-1" }),
      });
      expect(run.status).toBe(200);
      const payload = await run.json();
      expect(payload).toMatchObject({ ok: true, step: "done" });
      expect(payload.steps.map((s: { step: string }) => s.step)).toEqual(["webchat", "probe", "bind"]);
      expect(counters.webchatConv).toBe(1);
      expect(counters.webchatChat).toBe(1);
      expect(counters.checkin).toBe(1);
      expect(counters.bind).toBe(1);
      // webchat agent_task_created + probe chat_request_send
      expect(counters.report).toBe(2);

      const stored = instance.repos.providers.get(connection.id)!;
      const data = stored.data as Record<string, unknown>;
      expect(data.inviteBound).toBe(true);
      expect(data.inviteChain).toMatchObject({ step: "done", status: "done", error: null, inviteCode: "INV-1" });
    } finally {
      instance.close();
    }
  });

  test("stores the failed step and resumes from it", async () => {
    const instance = await runtime();
    try {
      const connection = cliConnection(instance);
      const app = createApp(instance);

      const phase1: Counters = { webchatConv: 0, webchatChat: 0, report: 0, checkin: 0, bind: 0 };
      installFetchMock(chainMocks(phase1, { checkinFail: true }));
      const failed = await app.request(`/api/usage/codebuddy-invite/${connection.id}/chain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "INV-1" }),
      });
      expect(failed.status).toBe(400);
      const failedPayload = await failed.json();
      expect(failedPayload).toMatchObject({ ok: false, step: "probe" });

      let stored = instance.repos.providers.get(connection.id)!;
      let chain = (stored.data as Record<string, unknown>).inviteChain as Record<string, unknown>;
      expect(chain).toMatchObject({ step: "probe", status: "failed", inviteCode: "INV-1" });
      expect(typeof chain.error).toBe("string");
      expect(chain.error).toBeTruthy();

      const phase2: Counters = { webchatConv: 0, webchatChat: 0, report: 0, checkin: 0, bind: 0 };
      installFetchMock(chainMocks(phase2));
      const resumed = await app.request(`/api/usage/codebuddy-invite/${connection.id}/chain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "INV-1" }),
      });
      expect(resumed.status).toBe(200);
      const resumedPayload = await resumed.json();
      expect(resumedPayload).toMatchObject({ ok: true, step: "done" });
      expect(resumedPayload.steps.map((s: { step: string }) => s.step)).toEqual(["probe", "bind"]);
      // web chat already passed in phase 1 — must not repeat.
      expect(phase2.webchatConv).toBe(0);
      expect(phase2.webchatChat).toBe(0);
      expect(phase2.checkin).toBe(1);
      expect(phase2.bind).toBe(1);

      stored = instance.repos.providers.get(connection.id)!;
      chain = (stored.data as Record<string, unknown>).inviteChain as Record<string, unknown>;
      expect(chain).toMatchObject({ step: "done", status: "done", error: null });
      expect((stored.data as Record<string, unknown>).inviteBound).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("rejects non-cli connections", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "codebuddy-cn",
        authType: "oauth",
        credentials: {},
        data: { accessToken: "at-1", refreshToken: "rt-1", codebuddyUserId: "uid-1" },
      });
      const app = createApp(instance);
      installFetchMock(chainMocks({ webchatConv: 0, webchatChat: 0, report: 0, checkin: 0, bind: 0 }));
      const res = await app.request(`/api/usage/codebuddy-invite/${connection.id}/chain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "INV-1" }),
      });
      expect(res.status).toBe(400);
      const payload = await res.json();
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("CodeBuddy intl CLI");
    } finally {
      instance.close();
    }
  });

  test("bulk chain aggregates success and failure", async () => {
    const instance = await runtime();
    try {
      const ok = cliConnection(instance);
      const bad = instance.repos.providers.create({
        provider: "codebuddy-cn",
        authType: "oauth",
        credentials: {},
        data: { accessToken: "at-2", refreshToken: "rt-2", codebuddyUserId: "uid-2" },
      });
      const app = createApp(instance);
      installFetchMock(chainMocks({ webchatConv: 0, webchatChat: 0, report: 0, checkin: 0, bind: 0 }));

      const res = await app.request("/api/usage/codebuddy-invite/chain-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionIds: [ok.id, bad.id], inviteCode: "INV-1" }),
      });
      expect(res.status).toBe(200);
      const payload = await res.json();
      expect(payload.success).toBe(1);
      expect(payload.failed).toBe(1);
      expect(payload.results).toHaveLength(2);
    } finally {
      instance.close();
    }
  });

  test("validates proxy pool id when provided", async () => {
    const instance = await runtime();
    try {
      const connection = cliConnection(instance);
      const app = createApp(instance);
      installFetchMock(chainMocks({ webchatConv: 0, webchatChat: 0, report: 0, checkin: 0, bind: 0 }));
      const res = await app.request(`/api/usage/codebuddy-invite/${connection.id}/chain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "INV-1", proxyPoolId: "does-not-exist" }),
      });
      expect(res.status).toBe(400);
      const payload = await res.json();
      expect(payload.error).toBe("Proxy pool not found");
    } finally {
      instance.close();
    }
  });
});
