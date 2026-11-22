import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { dashScopeSpeechFixture, FakeUpstream } from "@tests/support/fake-upstream.js";
import { insertApiKey, insertDashScopeSpeechModel } from "@tests/support/inference.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";
import { untilUsageQueueIsDrained } from "@tests/support/usage-queue.js";
import { writtenUsageLog } from "@tests/support/usage-logs.js";

// Needs Redis at REDIS_URL. Its own Redis database keeps jobs that other test
// files enqueued (with no worker running) out of this worker's way.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import("@tests/support/test-app.js");
const { WorkerModule } = await import("@/worker.module.js");
const { USAGE_QUEUE } = await import("@/queue/models/queue-names.js");

const SYNTHESIZER_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";

describe("Usage Logs of speech (e2e)", () => {
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
    await insertDashScopeSpeechModel(app, db, {
      modelName: "narrator",
      baseUrl: `${upstream.origin}/api/v1`,
      pricePerMillionCharacters: 20,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  it("records the characters DashScope counted and their Cost at the price per million", async () => {
    // DashScope counts the 22 characters of "Hello from the gateway".
    const answer = dashScopeSpeechFixture("upstream-response.json").replace(
      /https:\/\/[^"]*speech\.mp3[^"]*/,
      upstream.mediaUrl("/media/speech.mp3"),
    );
    upstream.replyTo(SYNTHESIZER_PATH, { kind: "json", status: 200, body: JSON.parse(answer) });
    upstream.replyTo("/media/speech.mp3", {
      kind: "binary",
      status: 200,
      contentType: "audio/mpeg",
      body: new Uint8Array([1, 2, 3]),
    });

    await request(app.getHttpServer())
      .post("/v1/audio/speech")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model: "narrator", input: "Hello from the gateway", voice: "Cherry" })
      .expect(200);

    expect(await writtenUsageLog(db)).toMatchObject({
      kind: "speech",
      clientProtocol: "openai-speech",
      characters: 22,
      cost: 0.00044,
      inputTokens: null,
      outputTokens: null,
      timeToFirstTokenMs: null,
      isIncomplete: false,
    });
  });
});
