import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { FakeUpstream, replyWithTwoDashScopeImages } from "../support/fake-upstream.js";
import { insertApiKey, insertDashScopeImageModel } from "../support/inference.js";
import { deleteAllUpstreamData } from "../support/upstream.js";
import { untilUsageQueueIsDrained } from "../support/usage-queue.js";
import { writtenUsageLog } from "../support/usage-logs.js";

// Needs Redis at REDIS_URL. Its own Redis database keeps jobs that other test
// files enqueued (with no worker running) out of this worker's way.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import("../support/test-app.js");
const { WorkerModule } = await import("@/worker.module.js");
const { USAGE_QUEUE } = await import("@/queue/models/queue-names.js");

describe("Usage Logs of image generation (e2e)", () => {
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
      pricePerImageBySize: { "1K": 0.04, "2K": 0.075 },
      pricePerInputImage: 0.003,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  it("records the images generated, their size tier and their Cost at that tier's price", async () => {
    replyWithTwoDashScopeImages(upstream);

    await request(app.getHttpServer())
      .post("/v1/images/generations")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model: "painter", prompt: "A red fox in snow", n: 2 })
      .expect(200);

    expect(await writtenUsageLog(db)).toMatchObject({
      kind: "image",
      clientProtocol: "openai-images",
      imagesOut: 2,
      unitTier: "1K",
      cost: 0.08,
      inputTokens: null,
      outputTokens: null,
      timeToFirstTokenMs: null,
      isIncomplete: false,
    });
  });

  it("records the input images of an edit, and prices them into its Cost", async () => {
    replyWithTwoDashScopeImages(upstream);

    await request(app.getHttpServer())
      .post("/v1/images/edits")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({
        model: "painter",
        prompt: "Swap the cat for the fox",
        images: [
          { image_url: "https://images.example.com/fox.png" },
          { image_url: "https://images.example.com/cat.png" },
        ],
      })
      .expect(200);

    // Two 1K images at $0.04, two input images at $0.003.
    expect(await writtenUsageLog(db)).toMatchObject({ imagesOut: 2, imagesIn: 2, cost: 0.086 });
  });
});
