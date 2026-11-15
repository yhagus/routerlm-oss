import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { usageLogs } from "@/db/schemas/index.js";
import { FakeUpstream, openAiChatFixture } from "../support/fake-upstream.js";
import { insertApiKey, insertOpenAiChatModel } from "../support/inference.js";
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

describe("Token usage an openai-chat upstream reports (e2e)", () => {
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
    // The previous test's job must not land after the tables are emptied.
    await untilUsageQueueIsDrained(usageQueue);
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

  it.each([
    [
      "leaves the cache read count empty when the upstream doesn't report it",
      { prompt_tokens: 120, completion_tokens: 30 },
      {
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: null,
        cacheWriteTokens: 0,
        reasoningTokens: null,
      },
    ],
    [
      "counts no cache write, even without a prompt count, since Chat Completions never reports one",
      { completion_tokens: 30 },
      {
        inputTokens: null,
        outputTokens: 30,
        cacheReadTokens: null,
        cacheWriteTokens: 0,
        reasoningTokens: null,
      },
    ],
    [
      "takes the cache write count a Provider with explicit caching reports out of the input",
      {
        prompt_tokens: 1200,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 0, cache_creation_input_tokens: 1100 },
      },
      {
        inputTokens: 100,
        outputTokens: 30,
        cacheReadTokens: 0,
        cacheWriteTokens: 1100,
        reasoningTokens: null,
      },
    ],
    [
      "leaves every count empty when the upstream sent no usage",
      undefined,
      {
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
      },
    ],
  ])("%s", async (_behaviour, upstreamUsage, recorded) => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: {
        ...JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
        usage: upstreamUsage,
      },
    });

    await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model: "smart", messages: [{ role: "user", content: "Hi" }] })
      .expect(200);

    expect(await writtenUsageLog()).toMatchObject(recorded);
  });
});
