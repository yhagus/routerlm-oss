import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-test-jobs-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

type JobSnapshot = {
  id: string;
  status: string;
  completed: number;
  total: number;
  passed: number;
  failed: number;
  items: Array<{ connectionId: string; status: string }>;
};

async function waitForJob(app: ReturnType<typeof createApp>, jobId: string, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await app.request(`/api/providers/test-jobs/${jobId}`);
    const job = await response.json() as JobSnapshot;
    if (job.status === "completed" || job.status === "cancelled" || job.status === "failed") return job;
    await Bun.sleep(20);
  }
  throw new Error("Timed out waiting for connection test job");
}

describe("connection test jobs", () => {
  test("enqueue stores a queued job for every provider connection", async () => {
    const instance = await runtime();
    try {
      const first = instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "Alpha", credentials: { apiKey: "k1" } });
      const second = instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "Beta", credentials: { apiKey: "k2" } });
      instance.repos.providers.create({ provider: "claude", authType: "oauth", name: "Other" });
      const app = createApp(instance);

      const response = await app.request("/api/providers/test-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "openai", delayMs: 0 }),
      });
      expect(response.status).toBe(201);
      const job = await response.json() as {
        id: string;
        providerId: string;
        status: string;
        total: number;
        items: Array<{ connectionId: string; status: string; position: number }>;
      };
      expect(job.providerId).toBe("openai");
      expect(["queued", "running"]).toContain(job.status);
      expect(job.total).toBe(2);
      expect(job.items.map((item) => item.connectionId).sort()).toEqual([first.id, second.id].sort());
      expect(job.items.every((item) => item.status === "queued" || item.status === "testing")).toBe(true);

      const stored = await app.request(`/api/providers/test-jobs/${job.id}`);
      expect(stored.status).toBe(200);
      expect((await stored.json() as { id: string }).id).toBe(job.id);
    } finally {
      instance.close();
    }
  });

  test("worker tests each connection and records pass and fail counts", async () => {
    const instance = await runtime();
    try {
      const pass = instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "Pass", credentials: { apiKey: "good" } });
      const fail = instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "Fail", credentials: { apiKey: "bad" } });
      installFetchMock(async (_input, init) => {
        const headers = new Headers((init?.headers || {}) as HeadersInit);
        const key = headers.get("authorization");
        if (key === "Bearer good") return Response.json({ data: [{ id: "gpt-4" }] });
        return new Response("unauthorized", { status: 401 });
      });
      const app = createApp(instance);
      const created = await app.request("/api/providers/test-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "openai", delayMs: 0 }),
      });
      const job = await created.json() as { id: string };
      const finished = await waitForJob(app, job.id);
      expect(finished.status).toBe("completed");
      expect(finished.total).toBe(2);
      expect(finished.completed).toBe(2);
      expect(finished.passed).toBe(1);
      expect(finished.failed).toBe(1);
      expect(finished.items.find((item) => item.connectionId === pass.id)?.status).toBe("success");
      expect(finished.items.find((item) => item.connectionId === fail.id)?.status).toBe("failed");
    } finally {
      instance.close();
    }
  });

  test("cancel stops remaining queued items", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "One", credentials: { apiKey: "k1" } });
      instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "Two", credentials: { apiKey: "k2" } });
      instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "Three", credentials: { apiKey: "k3" } });
      installFetchMock(async () => {
        await Bun.sleep(80);
        return Response.json({ data: [{ id: "gpt-4" }] });
      });
      const app = createApp(instance);
      const created = await app.request("/api/providers/test-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "openai", delayMs: 0 }),
      });
      const job = await created.json() as { id: string };
      const cancelled = await app.request(`/api/providers/test-jobs/${job.id}/cancel`, { method: "POST" });
      expect(cancelled.status).toBe(200);
      const finished = await waitForJob(app, job.id);
      expect(finished.status).toBe("cancelled");
      expect(finished.items.some((item) => item.status === "cancelled")).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("latest job for a provider remains readable after enqueue", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "Alpha", credentials: { apiKey: "k1" } });
      const app = createApp(instance);
      const created = await app.request("/api/providers/test-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "openai", delayMs: 0 }),
      });
      const job = await created.json() as { id: string };
      const latest = await app.request("/api/providers/test-jobs?providerId=openai");
      expect(latest.status).toBe(200);
      expect((await latest.json() as { id: string }).id).toBe(job.id);
    } finally {
      instance.close();
    }
  });

  test("rejects a second job while one is still running for the same provider", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "Alpha", credentials: { apiKey: "k1" } });
      installFetchMock(async () => {
        await Bun.sleep(200);
        return Response.json({ data: [{ id: "gpt-4" }] });
      });
      const app = createApp(instance);
      const first = await app.request("/api/providers/test-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "openai", delayMs: 50 }),
      });
      expect(first.status).toBe(201);
      const second = await app.request("/api/providers/test-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "openai", delayMs: 0 }),
      });
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: "A connection test job is already running for this provider" });
    } finally {
      instance.close();
    }
  });
});
