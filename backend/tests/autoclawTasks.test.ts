import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";
import { getAutoclawUsage } from "../src/services/billing/usageAutoclaw";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-autoclaw-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

function autoclawConnection(instance: Awaited<ReturnType<typeof runtime>>) {
  return instance.repos.providers.create({
    provider: "autoclaw",
    authType: "apikey",
    name: "AutoClaw Account",
    credentials: {},
    data: { refreshToken: "rt-1", accessToken: "at-1", deviceId: "device-1" },
  });
}

afterEach(() => {
  installFetchMock(null);
});

describe("autoclaw daily check-in", () => {
  test("claim route mints the daily sign-in reward and marks checked in", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);

      let taskListCalls = 0;
      let claimCalls = 0;
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("autoclaw-task-list")) {
          taskListCalls += 1;
          return Response.json({
            data: [
              { task_id: "daily_signin", title: "Daily Check In", reward_points: 400, status: "incomplete" },
              { task_id: "other_task", title: "Other", reward_points: 10, status: "incomplete" },
            ],
          });
        }
        if (url.includes("autoclaw-task-complete") && init?.method === "POST") {
          claimCalls += 1;
          return Response.json({
            data: { already_completed: false, reward_points: 400, success: true, task_id: "daily_signin" },
          });
        }
        return new Response("not found", { status: 404 });
      });

      const claim = await app.request(`/api/usage/autoclaw-tasks/${connection.id}/claim/daily_signin`, { method: "POST" });
      expect(claim.status).toBe(200);
      expect(await claim.json()).toMatchObject({ id: "daily_signin", ok: true, status: "claimed", rewardPoints: 400 });
      expect(taskListCalls).toBe(1);
      expect(claimCalls).toBe(1);

      const status = await app.request(`/api/usage/autoclaw-tasks/${connection.id}`);
      const payload = await status.json();
      expect(payload.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "daily_signin", claimed: true, rewardPoints: 400 }),
        ]),
      );

      // A second claim the same day must not re-hit the upstream endpoints.
      const second = await app.request(`/api/usage/autoclaw-tasks/${connection.id}/claim/daily_signin`, { method: "POST" });
      expect(await second.json()).toMatchObject({ id: "daily_signin", ok: true, status: "claimed", alreadyDone: true });
      expect(taskListCalls).toBe(1);
      expect(claimCalls).toBe(1);
    } finally {
      instance.close();
    }
  });

  test("completed upstream status records checked-in without claiming", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);

      let claimCalls = 0;
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("autoclaw-task-list")) {
          return Response.json({
            data: [{ task_id: "daily_signin", reward_points: 400, status: "completed" }],
          });
        }
        if (url.includes("autoclaw-task-complete") && init?.method === "POST") {
          claimCalls += 1;
          return Response.json({ data: { success: true } });
        }
        return new Response("not found", { status: 404 });
      });

      const claim = await app.request(`/api/usage/autoclaw-tasks/${connection.id}/claim/daily_signin`, { method: "POST" });
      expect(await claim.json()).toMatchObject({ id: "daily_signin", ok: true, status: "completed", alreadyDone: true });
      expect(claimCalls).toBe(0);
    } finally {
      instance.close();
    }
  });

  test("claim route rejects non-autoclaw connections", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "claude",
        authType: "oauth",
        credentials: { accessToken: "at-1" },
      });
      const app = createApp(instance);
      const response = await app.request(`/api/usage/autoclaw-tasks/${connection.id}/claim/daily_signin`, { method: "POST" });
      expect(response.status).toBe(400);
    } finally {
      instance.close();
    }
  });

  test("claim sends standard authorization + web client headers", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);
      let capturedHeaders: Headers | undefined;

      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("autoclaw-task-list")) {
          return Response.json({ data: [{ task_id: "daily_signin", reward_points: 400, status: "incomplete" }] });
        }
        if (url.includes("autoclaw-task-complete") && init?.method === "POST") {
          capturedHeaders = new Headers(init.headers as Record<string, string>);
          return Response.json({ data: { already_completed: false, reward_points: 400, success: true, task_id: "daily_signin" } });
        }
        return new Response("not found", { status: 404 });
      });

      await app.request(`/api/usage/autoclaw-tasks/${connection.id}/claim/daily_signin`, { method: "POST" });

      expect(capturedHeaders?.get("authorization")).toBe("Bearer at-1");
      expect(capturedHeaders?.get("x-client-type")).toBe("web");
      expect(capturedHeaders?.get("x-tm")).toBe("web");
      expect(capturedHeaders?.get("x-version")).toBe("1.12.1");
      expect(capturedHeaders?.get("x-auth-appid")).toBe("100003");
      expect(capturedHeaders?.get("X-Authorization")).toBeNull();
    } finally {
      instance.close();
    }
  });

  test("claim surfaces the upstream error response", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);

      installFetchMock(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("autoclaw-task-list")) {
          return Response.json({ data: [{ task_id: "daily_signin", reward_points: 400, status: "incomplete" }] });
        }
        if (url.includes("autoclaw-task-complete")) {
          return Response.json({ error: "Invalid token" }, { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

      const claim = await app.request(`/api/usage/autoclaw-tasks/${connection.id}/claim/daily_signin`, { method: "POST" });
      const payload = await claim.json();
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("Invalid token");
    } finally {
      instance.close();
    }
  });

  test("background sync records an upstream completed check-in locally", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);

      installFetchMock(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("autoclaw-task-list")) {
          return Response.json({ data: [{ task_id: "daily_signin", reward_points: 400, status: "completed" }] });
        }
        return new Response("not found", { status: 404 });
      });

      const { autoclawDayKey, runAutoclawTasksTick } = await import("../src/services/billing/autoclawTasksScheduler");
      await runAutoclawTasksTick(instance);

      const dayKey = autoclawDayKey();
      expect(instance.repos.autoclawTasks.get(connection.id, "daily_signin", dayKey)?.status).toBe("completed");

      // GET reads only the local DB (no upstream fetch at read time).
      const status = await app.request(`/api/usage/autoclaw-tasks/${connection.id}`);
      const payload = await status.json();
      expect(payload.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "daily_signin", claimed: true, rewardPoints: 400 }),
        ]),
      );
    } finally {
      instance.close();
    }
  });

  test("scheduler tick respects per-connection toggle", async () => {
    const instance = await runtime();
    try {
      const enabled = autoclawConnection(instance);
      const disabled = instance.repos.providers.create({
        provider: "autoclaw",
        authType: "apikey",
        credentials: {},
        data: { refreshToken: "rt-2", accessToken: "at-2", deviceId: "device-2" },
      });
      instance.repos.settings.update({
        autoclawAutoClaim: { intervalMinutes: 60, connections: { [enabled.id]: true, [disabled.id]: false } },
      });

      const { autoclawDayKey, runAutoclawTasksTick } = await import("../src/services/billing/autoclawTasksScheduler");
      installFetchMock(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("autoclaw-task-list")) {
          return Response.json({ data: [{ task_id: "daily_signin", reward_points: 400, status: "incomplete" }] });
        }
        if (url.includes("autoclaw-task-complete")) {
          return Response.json({ data: { already_completed: false, reward_points: 400, success: true, task_id: "daily_signin" } });
        }
        return new Response("not found", { status: 404 });
      });

      await runAutoclawTasksTick(instance);

      const dayKey = autoclawDayKey();
      expect(instance.repos.autoclawTasks.get(enabled.id, "daily_signin", dayKey)?.status).toBe("claimed");
      expect(instance.repos.autoclawTasks.get(disabled.id, "daily_signin", dayKey)).toBeNull();
    } finally {
      instance.close();
    }
  });

  test("usage filters wallets to reward, daily, and other", async () => {
    installFetchMock(async (input: RequestInfo | URL) => {
      if (String(input).includes("wallets")) {
        return Response.json({
          code: 0,
          data: {
            wallets: [
              { public_wallet_type: "reward", balance: 1000 },
              { public_wallet_type: "daily", balance: 400 },
              { public_wallet_type: "subscription", balance: 99999 },
              { public_wallet_type: "fuel_pack", balance: 500 },
              { public_wallet_type: "other", balance: 12 },
            ],
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const usage = await getAutoclawUsage("at-1", null);
    const quotas = (usage.quotas as Record<string, unknown>) || {};
    expect(Object.keys(quotas).sort()).toEqual(["daily", "other", "reward"]);
    expect(quotas.subscription).toBeUndefined();
    expect(quotas.fuel_pack).toBeUndefined();
  });
});
