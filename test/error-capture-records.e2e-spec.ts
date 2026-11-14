import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import { asc } from "drizzle-orm";
import request from "supertest";
import type { Database } from "../src/db/relations.js";
import { attempts, errorCaptures, usageLogs } from "../src/db/schema.js";
import { FakeUpstream, openAiChatFixture } from "./support/fake-upstream.js";
import { insertApiKey, insertOpenAiChatModel, UPSTREAM_KEY } from "./support/inference.js";
import { deleteAllUpstreamData } from "./support/upstream.js";

// Needs Redis at REDIS_URL, in its own database (see usage-records.e2e-spec.ts).
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import("./support/test-app.js");
const { WorkerModule } = await import("../src/worker.module.js");
const { USAGE_QUEUE } = await import("../src/queue/queue-names.js");

const PROMPT_TEXT = "Which umbrella should I pack for Lisbon?";
const CHAT_REQUEST = { model: "smart", messages: [{ role: "user", content: PROMPT_TEXT }] };
const SESSION_COOKIE = "__Host-sid=dashboard-session";
const WORKER_WRITE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;

describe("Error Captures written for failed requests (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let apiKey: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    usageQueue = app.get<Queue>(getQueueToken(USAGE_QUEUE));
    await usageQueue.obliterate({ force: true });
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await untilUsageQueueIsDrained();
    await deleteAllUpstreamData(db);
    await insertOpenAiChatModel(app, db, { modelName: "smart", baseUrl: upstream.baseUrl });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  function chat(body: unknown, key = apiKey) {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${key}`)
      .set("Cookie", SESSION_COOKIE)
      .send(body as object);
  }

  async function untilUsageQueueIsDrained(): Promise<void> {
    const deadline = Date.now() + WORKER_WRITE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const counts = await usageQueue.getJobCounts("waiting", "active", "delayed");
      if (Object.values(counts).every((count) => count === 0)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error("The worker did not finish the usage jobs");
  }

  /** The captures of the one request made, once the worker has written its Usage Log. */
  async function writtenCaptures() {
    const deadline = Date.now() + WORKER_WRITE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const [usageLog] = await db.select().from(usageLogs);
      if (usageLog) {
        const captures = await db
          .select()
          .from(errorCaptures)
          .orderBy(asc(errorCaptures.createdAt));
        const writtenAttempts = await db.select().from(attempts).orderBy(asc(attempts.startedAt));
        return { usageLog, attempts: writtenAttempts, captures };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error("The worker wrote no Usage Log");
  }

  it("captures a failed Attempt's request and upstream response, with every credential redacted", async () => {
    upstream.reply({
      kind: "json",
      status: 401,
      body: { error: { message: `Incorrect API key provided: ${UPSTREAM_KEY}` } },
      headers: { "set-cookie": "upstream-session=xyz", "x-echoed-key": UPSTREAM_KEY },
    });

    await chat(CHAT_REQUEST).expect(502);

    const written = await writtenCaptures();
    expect(written.captures).toHaveLength(1);
    const [capture] = written.captures;
    expect(capture).toMatchObject({
      usageLogId: written.usageLog.id,
      attemptId: written.attempts[0].id,
      requestHeaders: expect.objectContaining({
        authorization: "[REDACTED]",
        cookie: "[REDACTED]",
        "content-type": "application/json",
      }),
      responseHeaders: expect.objectContaining({
        "set-cookie": "[REDACTED]",
        "x-echoed-key": "[REDACTED]",
      }),
    });
    expect(JSON.parse(capture.requestBody)).toEqual(CHAT_REQUEST);
    expect(capture.responseBody).toContain("Incorrect API key provided: [REDACTED]");
    const stored = JSON.stringify(capture);
    expect(stored).not.toContain(apiKey);
    expect(stored).not.toContain(UPSTREAM_KEY);
    expect(stored).not.toContain("dashboard-session");
    expect(stored).not.toContain("upstream-session");
  });

  it("captures the client request alone when the request fails before any Attempt", async () => {
    await chat({ ...CHAT_REQUEST, model: "missing" }).expect(404);

    const written = await writtenCaptures();
    expect(written.captures).toEqual([
      expect.objectContaining({ attemptId: null, responseHeaders: null, responseBody: null }),
    ]);
    expect(written.captures[0].requestBody).toContain(PROMPT_TEXT);
  });

  it("stores no capture for a successful request", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await chat(CHAT_REQUEST).expect(200);

    expect((await writtenCaptures()).captures).toEqual([]);
  });

  it("stores no capture for a request without a valid API Key", async () => {
    await chat(CHAT_REQUEST, "rlm_not-a-real-key").expect(401);

    expect((await writtenCaptures()).captures).toEqual([]);
  });
});
