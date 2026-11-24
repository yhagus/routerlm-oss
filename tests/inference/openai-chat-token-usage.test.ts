import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { usageLogs } from "@/db/schemas/index.js";
import { FakeUpstream, openAiChatFixture } from "@tests/support/fake-upstream.js";
import { insertApiKey, insertOpenAiChatModel } from "@tests/support/inference.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";
import { untilUsageQueueIsDrained } from "@tests/support/usage-queue.js";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import("@tests/support/test-app.js");
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
      "reads the cache read count Kimi reports as cached_tokens beside the other counts",
      { prompt_tokens: 120, completion_tokens: 30, cached_tokens: 100 },
      {
        inputTokens: 20,
        outputTokens: 30,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
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

  it("reads the usage Kimi reports inside the first choice of a completion", async () => {
    const completion = JSON.parse(openAiChatFixture("upstream-response-tool-call.json"));
    const usageInChoice = {
      prompt_tokens: 120,
      completion_tokens: 30,
      prompt_tokens_details: { cached_tokens: 100 },
    };
    upstream.reply({
      kind: "json",
      status: 200,
      body: {
        ...completion,
        usage: undefined,
        choices: [{ ...completion.choices[0], usage: usageInChoice }],
      },
    });

    await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model: "smart", messages: [{ role: "user", content: "Hi" }] })
      .expect(200);

    expect(await writtenUsageLog()).toMatchObject({
      inputTokens: 20,
      outputTokens: 30,
      cacheReadTokens: 100,
    });
  });

  it("reads the usage Kimi reports inside the first choice of a stream's last chunk", async () => {
    const chunks = [
      { choices: [{ index: 0, delta: { role: "assistant", content: "Hello." } }] },
      {
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
            usage: { prompt_tokens: 120, completion_tokens: 30, cached_tokens: 100 },
          },
        ],
      },
    ];
    upstream.reply({
      kind: "stream",
      events: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
    });

    await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model: "smart", messages: [{ role: "user", content: "Hi" }], stream: true })
      .expect(200);

    expect(await writtenUsageLog()).toMatchObject({
      inputTokens: 20,
      outputTokens: 30,
      cacheReadTokens: 100,
    });
  });
});
