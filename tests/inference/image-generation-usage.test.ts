import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { usageLogs } from "@/db/schemas/index.js";
import { dashScopeImageFixture, FakeUpstream } from "../support/fake-upstream.js";
import { insertApiKey, insertDashScopeImageModel } from "../support/inference.js";
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
const GENERATION_PATH = "/api/v1/services/aigc/multimodal-generation/generation";

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

  async function writtenUsageLog() {
    const deadline = Date.now() + WORKER_WRITE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const [usageLog] = await db.select().from(usageLogs);
      if (usageLog) {
        return usageLog;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error("The worker wrote no Usage Log");
  }

  /** DashScope reports the 1024×1024 it generated: the 1K tier. */
  function answerWithTwoImages(): void {
    const answer = dashScopeImageFixture("upstream-response.json")
      .replace(/https:\/\/[^"]*first\.png[^"]*/, upstream.mediaUrl("/media/a.png"))
      .replace(/https:\/\/[^"]*second\.png[^"]*/, upstream.mediaUrl("/media/b.png"));
    upstream.replyTo(GENERATION_PATH, { kind: "json", status: 200, body: JSON.parse(answer) });
    for (const path of ["/media/a.png", "/media/b.png"]) {
      upstream.replyTo(path, {
        kind: "binary",
        status: 200,
        contentType: "image/png",
        body: new Uint8Array([1, 2, 3]),
      });
    }
  }

  it("records the images generated, their size tier and their Cost at that tier's price", async () => {
    answerWithTwoImages();

    await request(app.getHttpServer())
      .post("/v1/images/generations")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model: "painter", prompt: "A red fox in snow", n: 2 })
      .expect(200);

    expect(await writtenUsageLog()).toMatchObject({
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
    answerWithTwoImages();

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
    expect(await writtenUsageLog()).toMatchObject({ imagesOut: 2, imagesIn: 2, cost: 0.086 });
  });
});
