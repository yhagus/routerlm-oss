import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-codebuddy-probe-${crypto.randomUUID()}`,
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

function reportMock(calls: { count: number }) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v2/report") && init?.method === "POST") {
      calls.count += 1;
      return new Response("{}", { status: 200 });
    }
    if (url.includes("checkin-activity-status") && init?.method === "POST") {
      return new Response(JSON.stringify({ code: 0, data: { today_checked_in: true, active: true, streak_days: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
}

afterEach(() => {
  installFetchMock(null);
});

describe("codebuddy daily probe", () => {
  test("run route sends one report event and marks probed", async () => {
    const instance = await runtime();
    try {
      const connection = codebuddyCliConnection(instance);
      const app = createApp(instance);

      const calls = { count: 0 };
      let capturedBody: unknown = null;
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v2/report") && init?.method === "POST") {
          calls.count += 1;
          capturedBody = JSON.parse(String(init.body));
          return new Response("{}", { status: 200 });
        }
        if (url.includes("checkin-activity-status") && init?.method === "POST") {
          return new Response(JSON.stringify({ code: 0, data: { today_checked_in: true, active: true, streak_days: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("not found", { status: 404 });
      });

      const run = await app.request(`/api/usage/codebuddy-probe/${connection.id}/run`, { method: "POST" });
      expect(run.status).toBe(200);
      const runPayload = await run.json();
      expect(runPayload).toMatchObject({ ok: true, status: "completed", alreadyDone: false, reported: true });
      expect(runPayload.checkin).toBeDefined();
      expect(runPayload.checkin.state).toBe("already_claimed");
      expect(runPayload.checkin.streakDays).toBe(1);
      expect(calls.count).toBe(1);
      expect(Array.isArray(capturedBody)).toBe(true);
      const event = (capturedBody as Array<Record<string, unknown>>)[0];
      expect(event).toMatchObject({ eventCode: "chat_request_send", agentName: "codebuddy", agentType: "main", product: "SaaS", userId: "uid-1" });

      const status = await app.request(`/api/usage/codebuddy-probe/${connection.id}`);
      const payload = await status.json();
      expect(payload.probe).toMatchObject({ probed: true, reported: true });
      expect(payload.probe.checkin).toBeDefined();
      expect(payload.probe.checkin.state).toBe("already_claimed");

      // A second run the same day must not re-hit the upstream endpoint.
      const second = await app.request(`/api/usage/codebuddy-probe/${connection.id}/run`, { method: "POST" });
      expect(await second.json()).toMatchObject({ ok: true, status: "completed", alreadyDone: true });
      expect(calls.count).toBe(1);
    } finally {
      instance.close();
    }
  });

  test("run route rejects non-codebuddy-intl-cli connections", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "codebuddy-cn",
        authType: "oauth",
        credentials: { accessToken: "at-1" },
      });
      const app = createApp(instance);
      const response = await app.request(`/api/usage/codebuddy-probe/${connection.id}/run`, { method: "POST" });
      expect(response.status).toBe(400);
    } finally {
      instance.close();
    }
  });

  test("run surfaces the upstream error response", async () => {
    const instance = await runtime();
    try {
      const connection = codebuddyCliConnection(instance);
      const app = createApp(instance);

      installFetchMock(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("checkin-activity-status")) {
          return new Response("quota exceeded", { status: 429 });
        }
        return new Response("not found", { status: 404 });
      });

      const run = await app.request(`/api/usage/codebuddy-probe/${connection.id}/run`, { method: "POST" });
      const payload = await run.json();
      expect(payload.ok).toBe(false);
      expect(payload.status).toBe("error");
      expect(payload.checkin).toBeDefined();
      expect(payload.checkin.state).toBe("error");
      expect(payload.reported).toBe(false);
    } finally {
      instance.close();
    }
  });

  test("scheduler tick respects per-connection toggle", async () => {
    const instance = await runtime();
    try {
      const enabled = codebuddyCliConnection(instance);
      const disabled = instance.repos.providers.create({
        provider: "codebuddy-intl-cli",
        authType: "oauth",
        credentials: {},
        data: { accessToken: "at-2", refreshToken: "rt-2", codebuddyUserId: "uid-2" },
      });
      instance.repos.settings.update({
        codebuddyIntlCliDailyProbe: { intervalMinutes: 60, connections: { [enabled.id]: true, [disabled.id]: false } },
      });

      const { codebuddyProbeDayKey, runCodebuddyProbeTick } = await import("../src/services/providers/codebuddyProbeScheduler");
      const calls = { count: 0 };
      installFetchMock(reportMock(calls));

      await runCodebuddyProbeTick(instance);

      const dayKey = codebuddyProbeDayKey();
      expect(instance.repos.autoclawTasks.get(enabled.id, "daily_probe", dayKey)?.status).toBe("completed");
      expect(instance.repos.autoclawTasks.get(disabled.id, "daily_probe", dayKey)).toBeNull();
      expect(calls.count).toBe(1);
    } finally {
      instance.close();
    }
  });
});
