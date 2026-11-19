import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { usageLogs } from "@/db/schemas/index.js";
import { dashScopeVideoFixture, FakeUpstream } from "../support/fake-upstream.js";
import { insertApiKey, insertDashScopeVideoModel } from "../support/inference.js";
import { deleteAllUpstreamData } from "../support/upstream.js";
import { untilUsageQueueIsDrained } from "../support/usage-queue.js";

// Needs Redis at REDIS_URL. Its own Redis database keeps jobs that other test
// files enqueued (with no worker running) out of this worker's way.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import("../support/test-app.js");
const { WorkerModule } = await import("@/worker.module.js");
const { USAGE_QUEUE } = await import("@/queue/models/queue-names.js");

const WORKER_WRITE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;
const SYNTHESIS_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const TASK_PATH = "/api/v1/tasks/0385dc79-5ff8-4d82-bcb6-6f2a8e5c1d21";

describe("Usage Logs of Video Jobs (e2e)", () => {
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
    await untilUsageQueueIsDrained(usageQueue);
    await deleteAllUpstreamData(db);
    await insertDashScopeVideoModel(app, db, {
      modelName: "director",
      baseUrl: `${upstream.origin}/api/v1`,
      pricePerSecondByResolution: { "480P": 0.05, "720P": 0.1, "1080P": 0.2 },
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  async function writtenUsageLogs() {
    const deadline = Date.now() + WORKER_WRITE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const written = await db.select().from(usageLogs);
      if (written.length > 0) {
        return written;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error("The worker wrote no Usage Log");
  }

  it("writes one Usage Log at submit, costed at the requested seconds and resolution, and none for polls", async () => {
    upstream.replyTo(SYNTHESIS_PATH, {
      kind: "json",
      status: 200,
      body: JSON.parse(dashScopeVideoFixture("upstream-create-response.json")),
    });
    upstream.replyTo(TASK_PATH, {
      kind: "json",
      status: 200,
      body: { output: { task_id: "0385dc79-5ff8-4d82-bcb6-6f2a8e5c1d21", task_status: "RUNNING" } },
    });

    const submitted = await request(app.getHttpServer())
      .post("/v1/videos")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model: "director", prompt: "A red fox", seconds: "5", size: "1280x720" })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/v1/videos/${submitted.body.id}`)
      .set("Authorization", `Bearer ${apiKey}`)
      .expect(200);
    await untilUsageQueueIsDrained(usageQueue);

    expect(await writtenUsageLogs()).toEqual([
      expect.objectContaining({
        kind: "video",
        clientProtocol: "openai-videos",
        outputSeconds: 5,
        unitTier: "720P",
        cost: 0.5,
        inputTokens: null,
        timeToFirstTokenMs: null,
      }),
    ]);
  });
});
