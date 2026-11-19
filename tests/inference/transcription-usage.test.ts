import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { MAX_UPLOAD_BYTES } from "@/inference/models/media-upload.js";
import { dashScopeTranscriptionFixture, FakeUpstream } from "../support/fake-upstream.js";
import { insertApiKey, insertDashScopeTranscriptionModel } from "../support/inference.js";
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

const GENERATION_PATH = "/api/v1/services/aigc/multimodal-generation/generation";

describe("Usage Logs of transcription (e2e)", () => {
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
    await insertDashScopeTranscriptionModel(app, db, {
      modelName: "scribe",
      baseUrl: `${upstream.origin}/api/v1`,
      pricePerAudioSecond: 0.000035,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  it("records the audio seconds DashScope billed and their Cost at the price per second", async () => {
    // The recorded answer bills 4 seconds of audio.
    upstream.replyTo(GENERATION_PATH, {
      kind: "json",
      status: 200,
      body: JSON.parse(dashScopeTranscriptionFixture("upstream-response.json")),
    });

    await request(app.getHttpServer())
      .post("/v1/audio/transcriptions")
      .set("Authorization", `Bearer ${apiKey}`)
      .field("model", "scribe")
      .attach("file", Buffer.from([0x49, 0x44, 0x33]), {
        filename: "speech.mp3",
        contentType: "audio/mpeg",
      })
      .expect(200);

    expect(await writtenUsageLog(db)).toMatchObject({
      kind: "transcription",
      clientProtocol: "openai-transcription",
      audioSeconds: 4,
      cost: 0.00014,
      inputTokens: null,
      outputTokens: null,
      timeToFirstTokenMs: null,
      isIncomplete: false,
    });
  });

  it("records an upload refused as too large against transcription", async () => {
    await request(app.getHttpServer())
      .post("/v1/audio/transcriptions")
      .set("Authorization", `Bearer ${apiKey}`)
      .field("model", "scribe")
      .attach("file", Buffer.alloc(MAX_UPLOAD_BYTES + 1), {
        filename: "long.mp3",
        contentType: "audio/mpeg",
      })
      .expect(413);

    expect(await writtenUsageLog(db)).toMatchObject({
      kind: "transcription",
      clientProtocol: "openai-transcription",
      errorCode: "request_too_large",
    });
  });
});
