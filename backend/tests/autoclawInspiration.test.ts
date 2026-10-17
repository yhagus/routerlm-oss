import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-autoclaw-inspiration-${crypto.randomUUID()}`,
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

interface MockCard {
  id: string;
  title: string;
  prompt: string;
}

// Stateful upstream mock: the list reflects `completed`, and each accepted
// complete call flips its card — unless `flipOnComplete` is false.
function installInspirationMock(cards: MockCard[], options: { completed?: string[]; flipOnComplete?: boolean; failComplete?: boolean; calls?: { list: number; complete: number }; captured?: { body: Record<string, unknown> | null; lang: string | null } } = {}) {
  const completed = new Set(options.completed || []);
  const calls = options.calls || { list: 0, complete: 0 };
  const captured = options.captured || { body: null, lang: null };
  const completedIds: string[] = [];
  installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("inspiration-task-complete") && init?.method === "POST") {
      calls.complete += 1;
      const body = JSON.parse(String(init.body)) as { inspiration_id?: string };
      if (options.failComplete) return Response.json({ code: 500, msg: "busy" }, { status: 200 });
      if (body.inspiration_id) {
        completedIds.push(body.inspiration_id);
        if (options.flipOnComplete !== false) completed.add(body.inspiration_id);
      }
      return Response.json({ code: 0, msg: "SUCCESS", data: {} }, { status: 200 });
    }
    if (url.includes("inspiration-center") && init?.method === "POST") {
      calls.list += 1;
      captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      captured.lang = new Headers(init?.headers).get("x-lang");
      return Response.json({
        code: 0,
        data: {
          list: cards.map((card) => ({
            inspiration_id: card.id,
            title: card.title,
            reward_points: 200,
            action_config: JSON.stringify({ button: { prompt: card.prompt } }),
            completed: completed.has(card.id),
          })),
        },
      });
    }
    return new Response("not found", { status: 404 });
  });
  return { calls, captured, completedIds };
}

const CARDS: MockCard[] = [
  { id: "id-1", title: "First", prompt: "Prompt one" },
  { id: "id-2", title: "Second", prompt: "Prompt two" },
  { id: "id-3", title: "Done", prompt: "Prompt three" },
];

afterEach(() => {
  installFetchMock(null);
});

describe("autoclaw inspiration center", () => {
  test("claim completes each pending card once and marks completed", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);

      const { calls, completedIds } = installInspirationMock(CARDS, { completed: ["id-3"] });

      const claim = await app.request(`/api/usage/autoclaw-tasks/${connection.id}/claim/inspiration_center`, { method: "POST" });
      expect(claim.status).toBe(200);
      expect(await claim.json()).toMatchObject({ id: "inspiration_center", ok: true, status: "completed", rewardPoints: 400 });
      // Only the two pending cards complete upstream; the completed one is skipped.
      expect(calls.complete).toBe(2);
      expect(completedIds).toEqual(["id-1", "id-2"]);

      const status = await app.request(`/api/usage/autoclaw-tasks/${connection.id}`);
      const payload = await status.json();
      expect(payload.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "inspiration_center", claimed: true, rewardPoints: 600 }),
        ]),
      );

      // A second claim must not re-hit the upstream endpoints (one-time event).
      const second = await app.request(`/api/usage/autoclaw-tasks/${connection.id}/claim/inspiration_center`, { method: "POST" });
      expect(await second.json()).toMatchObject({ id: "inspiration_center", ok: true, status: "completed", alreadyDone: true });
      expect(calls.complete).toBe(2);
    } finally {
      instance.close();
    }
  });

  test("all completed upstream records completed without completing", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);

      const { calls } = installInspirationMock(CARDS.slice(0, 1), { completed: ["id-1"] });

      const claim = await app.request(`/api/usage/autoclaw-tasks/${connection.id}/claim/inspiration_center`, { method: "POST" });
      expect(await claim.json()).toMatchObject({ id: "inspiration_center", ok: true, status: "completed", alreadyDone: true, rewardPoints: 200 });
      expect(calls.complete).toBe(0);
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
        if (String(input).includes("inspiration-center")) {
          return Response.json({ code: 500, msg: "busy" }, { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

      const claim = await app.request(`/api/usage/autoclaw-tasks/${connection.id}/claim/inspiration_center`, { method: "POST" });
      const payload = await claim.json();
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("busy");
    } finally {
      instance.close();
    }
  });

  test("claim route rejects unknown claim types", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);
      const response = await app.request(`/api/usage/autoclaw-tasks/${connection.id}/claim/nope`, { method: "POST" });
      expect(response.status).toBe(400);
    } finally {
      instance.close();
    }
  });

  test("list syncs upstream completed cards instantly without completing", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);

      const captured: { body: Record<string, unknown> | null; lang: string | null } = { body: null, lang: null };
      const { calls } = installInspirationMock([CARDS[0]!, CARDS[2]!], { completed: ["id-3"], captured });

      const list = await app.request(`/api/usage/inspiration-center/${connection.id}`);
      expect(list.status).toBe(200);
      expect(captured.body).toMatchObject({ source_id: "autoclaw", device_id: "device-1", language: "id" });
      expect(captured.lang).toBe("id");
      expect(await list.json()).toEqual({
        language: "id",
        items: [
          expect.objectContaining({ inspiration_id: "id-1", title: "First", reward_points: 200, completed: false, done: false }),
          expect.objectContaining({ inspiration_id: "id-3", title: "Done", reward_points: 200, completed: true, done: true }),
        ],
      });
      expect(calls.complete).toBe(0);
    } finally {
      instance.close();
    }
  });

  test("claim completes a single card and leaves the rest pending", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);

      const { calls } = installInspirationMock(CARDS.slice(0, 2));

      const claim = await app.request(`/api/usage/inspiration-center/${connection.id}/claim`, {
        method: "POST",
        body: JSON.stringify({ inspiration_id: "id-1" }),
      });
      expect(claim.status).toBe(200);
      expect(await claim.json()).toMatchObject({ ok: true, status: "completed", rewardPoints: 200, alreadyDone: false });
      expect(calls.complete).toBe(1);

      const list = await app.request(`/api/usage/inspiration-center/${connection.id}`);
      expect(await list.json()).toEqual({
        language: "id",
        items: [
          expect.objectContaining({ inspiration_id: "id-1", done: true }),
          expect.objectContaining({ inspiration_id: "id-2", done: false }),
        ],
      });

      // Claiming an unknown card id fails without completing.
      const unknown = await app.request(`/api/usage/inspiration-center/${connection.id}/claim`, {
        method: "POST",
        body: JSON.stringify({ inspiration_id: "nope" }),
      });
      expect(await unknown.json()).toMatchObject({ ok: false, error: "Unknown inspiration." });
      expect(calls.complete).toBe(1);
    } finally {
      instance.close();
    }
  });

  test("claim reports rejected cards without recording done", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);

      installInspirationMock(CARDS.slice(0, 1), { failComplete: true });

      const claim = await app.request(`/api/usage/inspiration-center/${connection.id}/claim`, {
        method: "POST",
        body: JSON.stringify({ inspiration_id: "id-1" }),
      });
      const payload = await claim.json();
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("busy");

      const list = await app.request(`/api/usage/inspiration-center/${connection.id}`);
      expect(await list.json()).toEqual({
        language: "id",
        items: [expect.objectContaining({ inspiration_id: "id-1", done: false })],
      });
    } finally {
      instance.close();
    }
  });

  test("list reverts stale local flags when upstream still shows pending", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);
      instance.repos.autoclawTasks.upsert({ connectionId: connection.id, taskId: "inspiration:id-1", day: "2000-01-01", status: "completed", rewardPoints: 200, alreadyCompleted: false, error: null, payload: {} });
      instance.repos.autoclawTasks.upsert({ connectionId: connection.id, taskId: "inspiration_center", day: "2000-01-01", status: "completed", rewardPoints: 200, alreadyCompleted: false, error: null, payload: {} });

      installInspirationMock(CARDS.slice(0, 1));

      const list = await app.request(`/api/usage/inspiration-center/${connection.id}`);
      expect(await list.json()).toEqual({
        language: "id",
        items: [expect.objectContaining({ inspiration_id: "id-1", completed: false, done: false })],
      });
      expect(instance.repos.autoclawTasks.listByConnection(connection.id)).toEqual([]);
    } finally {
      instance.close();
    }
  });

  test("list and claim scope records by language", async () => {
    const instance = await runtime();
    try {
      const connection = autoclawConnection(instance);
      const app = createApp(instance);

      const captured: { body: Record<string, unknown> | null; lang: string | null } = { body: null, lang: null };
      installInspirationMock(CARDS.slice(0, 1), { captured });

      const list = await app.request(`/api/usage/inspiration-center/${connection.id}?language=en`);
      const payload = await list.json();
      expect(payload.language).toBe("en");
      expect(captured.body).toMatchObject({ language: "en" });
      expect(captured.lang).toBe("en");

      const claim = await app.request(`/api/usage/inspiration-center/${connection.id}/claim`, {
        method: "POST",
        body: JSON.stringify({ inspiration_id: "id-1", language: "en" }),
      });
      expect(await claim.json()).toMatchObject({ ok: true, status: "completed" });

      const records = instance.repos.autoclawTasks.listByConnection(connection.id);
      expect(records.map((record) => record.taskId).sort()).toEqual(["inspiration:id-1", "inspiration_center:en"]);

      // An unsupported language falls back to id.
      await app.request(`/api/usage/inspiration-center/${connection.id}?language=xx`);
      expect(captured.body).toMatchObject({ language: "id" });
      expect(captured.lang).toBe("id");
    } finally {
      instance.close();
    }
  });

  test("scheduler tick auto-runs one-time campaigns for enabled connections", async () => {
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

      const { autoclawDayKey } = await import("../src/services/billing/autoclawTasksScheduler");
      const { runAutoclawTasksTick } = await import("../src/services/billing/autoclawTasksScheduler");
      const completed = new Set<string>();
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("autoclaw-task-list")) {
          return Response.json({ data: [{ task_id: "daily_signin", reward_points: 400, status: "completed" }] });
        }
        if (url.includes("fission-v2/login-reward")) {
          return Response.json({ code: 0, data: { login_reward: { already_rewarded: false, reward_amount: 500 } } });
        }
        if (url.includes("inspiration-task-complete") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { inspiration_id?: string };
          if (body.inspiration_id) completed.add(body.inspiration_id);
          return Response.json({ code: 0, msg: "SUCCESS", data: {} });
        }
        if (url.includes("inspiration-center")) {
          return Response.json({
            code: 0,
            data: {
              list: [{ inspiration_id: "tick-1", title: "Tick", reward_points: 200, action_config: JSON.stringify({ button: { prompt: "Tick prompt" } }), completed: completed.has("tick-1") }],
            },
          });
        }
        return new Response("not found", { status: 404 });
      });

      await runAutoclawTasksTick(instance);

      const dayKey = autoclawDayKey();
      expect(instance.repos.autoclawTasks.get(enabled.id, "fission_login_reward", dayKey)?.status).toBe("claimed");
      expect(instance.repos.autoclawTasks.get(enabled.id, "fission_login_reward", dayKey)?.rewardPoints).toBe(500);
      const aggregate = instance.repos.autoclawTasks.listByConnection(enabled.id)
        .find((record) => record.taskId === "inspiration_center:id");
      expect(aggregate?.status).toBe("completed");
      const disabledTasks = instance.repos.autoclawTasks.listByConnection(disabled.id).map((record) => record.taskId);
      expect(disabledTasks).not.toContain("fission_login_reward");
      expect(disabledTasks.some((taskId) => taskId.startsWith("inspiration"))).toBe(false);
    } finally {
      instance.close();
    }
  });
});
