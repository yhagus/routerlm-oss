import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import { isNotNull } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { errorCaptures } from "@/db/schemas/index.js";
import { DASHSCOPE_GENERATION_PATH, FakeUpstream } from "../support/fake-upstream.js";
import { insertApiKey, insertDashScopeImageModel } from "../support/inference.js";
import { deleteAllUpstreamData } from "../support/upstream.js";
import { writtenUsageLog } from "../support/usage-logs.js";
import { untilUsageQueueIsDrained } from "../support/usage-queue.js";

// Needs Redis at REDIS_URL, in its own database (see tests/usage/records.test.ts).
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import("../support/test-app.js");
const { WorkerModule } = await import("@/worker.module.js");
const { USAGE_QUEUE } = await import("@/queue/models/queue-names.js");

const PROMPT = "Put the fox in the cat's place";
const FOX_PNG = Buffer.alloc(2048, 7);

describe("Error Captures of failed media requests (e2e)", () => {
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
    await insertDashScopeImageModel(app, db, {
      modelName: "painter",
      baseUrl: `${upstream.origin}/api/v1`,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  it("stores an uploaded image as a placeholder, keeping the prompt", async () => {
    upstream.replyTo(DASHSCOPE_GENERATION_PATH, {
      kind: "json",
      status: 500,
      body: { code: "InternalError", message: "boom", request_id: "req-1" },
    });

    await request(app.getHttpServer())
      .post("/v1/images/edits")
      .set("Authorization", `Bearer ${apiKey}`)
      .field("model", "painter")
      .field("prompt", PROMPT)
      .attach("image[]", FOX_PNG, { filename: "fox.png", contentType: "image/png" })
      .expect(502);
    await writtenUsageLog(db);

    const [capture] = await db
      .select({ requestBody: errorCaptures.requestBody })
      .from(errorCaptures);
    expect(capture.requestBody).toContain(PROMPT);
    expect(capture.requestBody).toContain("<image/png, 2 KB>");
    expect(capture.requestBody).not.toContain("data:");
    expect(capture.requestBody).not.toContain(FOX_PNG.toString("base64").slice(0, 64));
  });

  it("keeps DashScope's request_id in the failed Attempt's capture", async () => {
    upstream.replyTo(DASHSCOPE_GENERATION_PATH, {
      kind: "json",
      status: 500,
      body: { code: "InternalError", message: "boom", request_id: "dashscope-request-42" },
    });

    await request(app.getHttpServer())
      .post("/v1/images/generations")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model: "painter", prompt: PROMPT })
      .expect(502);
    await writtenUsageLog(db);

    const [capture] = await db
      .select({ responseBody: errorCaptures.responseBody })
      .from(errorCaptures)
      .where(isNotNull(errorCaptures.attemptId));
    expect(capture.responseBody).toContain("dashscope-request-42");
  });
});
