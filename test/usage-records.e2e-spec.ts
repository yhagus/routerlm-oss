import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import { asc, eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { attempts, upstreamModels, usageLogs } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { FakeUpstream, openAiChatFixture } from "./support/fake-upstream.js";
import { addProviderAccount, insertApiKey, insertOpenAiChatModel } from "./support/inference.js";
import { portOf } from "./support/port-of.js";
import { deleteAllUpstreamData } from "./support/upstream.js";
import { untilUsageQueueIsDrained } from "./support/usage-queue.js";

// Needs Redis at REDIS_URL. Its own Redis database keeps jobs that other test
// files enqueued (with no worker running) out of this worker's way.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import("./support/test-app.js");
const { WorkerModule } = await import("@/worker.module.js");
const { USAGE_QUEUE } = await import("@/queue/models/queue-names.js");

const PROMPT_TEXT = "Which umbrella should I pack for Lisbon?";
const RESPONSE_TEXT = "Checking the weather.";
const CHAT_REQUEST = { model: "smart", messages: [{ role: "user", content: PROMPT_TEXT }] };
const WORKER_WRITE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;

describe("Usage Logs and Attempts (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let apiKey: string;
  let apiKeyId: string;
  let modelId: string;
  let routeId: string;
  let providerId: string;
  let upstreamModelId: string;

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
    ({ modelId, routeId, providerId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.baseUrl,
    }));
    [{ id: upstreamModelId }] = await db
      .update(upstreamModels)
      .set({ inputPrice: 2, outputPrice: 8, cacheReadPrice: 0.5, cacheWritePrice: 2.5 })
      .returning({ id: upstreamModels.id });
    await app.get(SnapshotService).changed();
    ({ key: apiKey, id: apiKeyId } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  function chat(body: object, key = apiKey) {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${key}`)
      .send(body);
  }

  async function writtenUsageLog() {
    const deadline = Date.now() + WORKER_WRITE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const [usageLog] = await db.select().from(usageLogs);
      if (usageLog) {
        const writtenAttempts = await db
          .select()
          .from(attempts)
          .where(eq(attempts.usageLogId, usageLog.id))
          .orderBy(asc(attempts.startedAt));
        return { usageLog, attempts: writtenAttempts };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error("The worker wrote no Usage Log");
  }

  it("records a served request with its tokens, Cost and Attempt", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await chat(CHAT_REQUEST).expect(200);

    const written = await writtenUsageLog();
    expect(written.usageLog).toMatchObject({
      apiKeyId,
      userId: null,
      isPlayground: false,
      modelId,
      routeId,
      clientProtocol: "openai-chat",
      isStreamed: false,
      httpStatus: 200,
      errorCode: null,
      // The fixture reports 120 prompt tokens, 100 of them cache reads.
      inputTokens: 20,
      outputTokens: 40,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      reasoningTokens: 12,
      attemptCount: 1,
      isCancelled: false,
      isIncomplete: false,
    });
    // (20 x 2 + 40 x 8 + 100 x 0.5) per million tokens.
    expect(written.usageLog.cost).toBeCloseTo(0.00041, 10);
    expect(written.usageLog.requestBytes).toBe(JSON.stringify(CHAT_REQUEST).length);
    expect(written.usageLog.responseBytes).toBeGreaterThan(0);
    expect(written.attempts).toEqual([
      expect.objectContaining({ routeId, upstreamStatus: 200, failureReason: null }),
    ]);
  });

  it("keeps the Cost a request had when the price changes before the worker writes it", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });
    await worker.close();

    await chat(CHAT_REQUEST).expect(200);
    await db
      .update(upstreamModels)
      .set({ inputPrice: 1000, outputPrice: 1000 })
      .where(eq(upstreamModels.id, upstreamModelId));
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();

    const written = await writtenUsageLog();
    expect(written.usageLog.cost).toBeCloseTo(0.00041, 10);
  });

  it("enqueues no prompt or response content", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });
    const enqueued = vi.spyOn(usageQueue, "add");

    const response = await chat(CHAT_REQUEST).expect(200);

    expect(response.text).toContain(RESPONSE_TEXT);
    expect(enqueued).toHaveBeenCalledOnce();
    const jobPayload = JSON.stringify(enqueued.mock.calls[0][1]);
    expect(jobPayload).not.toContain(PROMPT_TEXT);
    expect(jobPayload).not.toContain(RESPONSE_TEXT);
    expect(jobPayload).not.toContain("Paris");
  });

  it("records one Attempt per upstream call when Fallback moves to the next Provider Account", async () => {
    const secondAccountId = await addProviderAccount(app, db, providerId, {
      key: "sk-second-account",
      priority: 1,
    });
    upstream.reply({ kind: "json", status: 500, body: { error: { message: "down" } } });
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await chat(CHAT_REQUEST).expect(200);

    const written = await writtenUsageLog();
    expect(written.usageLog).toMatchObject({
      attemptCount: 2,
      providerAccountId: secondAccountId,
    });
    expect(written.attempts).toEqual([
      expect.objectContaining({ upstreamStatus: 500, failureReason: "server_error" }),
      expect.objectContaining({
        providerAccountId: secondAccountId,
        upstreamStatus: 200,
        failureReason: null,
      }),
    ]);
  });

  it("flags a stream the client left as cancelled", async () => {
    const firstChunk = openAiChatFixture("upstream-stream-tool-call.sse").split("\n\n")[0] + "\n\n";
    upstream.reply({ kind: "stream", events: firstChunk, holdOpen: true });
    const server = await app.listen(0, "127.0.0.1");
    const port = portOf(server.address());
    const client = new AbortController();

    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ ...CHAT_REQUEST, stream: true }),
      signal: client.signal,
    });
    await response.body?.getReader().read();
    client.abort();

    const written = await writtenUsageLog();
    expect(written.usageLog).toMatchObject({
      isStreamed: true,
      httpStatus: 200,
      isCancelled: true,
      isIncomplete: true,
      inputTokens: null,
    });
    expect(written.usageLog.timeToFirstTokenMs).not.toBeNull();
    expect(written.attempts).toEqual([expect.objectContaining({ failureReason: "cancelled" })]);
  });

  it("records a request refused before any Attempt, with its error code", async () => {
    await chat({ ...CHAT_REQUEST, model: "no-such-model" }).expect(404);

    const written = await writtenUsageLog();
    expect(written.usageLog).toMatchObject({
      apiKeyId,
      modelId: null,
      httpStatus: 404,
      errorCode: "model_not_found",
      attemptCount: 0,
      isIncomplete: false,
    });
  });

  it("records a request with a wrong API Key without a caller", async () => {
    await chat(CHAT_REQUEST, "rlm_wrong_key").expect(401);

    const written = await writtenUsageLog();
    expect(written.usageLog).toMatchObject({
      apiKeyId: null,
      httpStatus: 401,
      errorCode: "invalid_api_key",
      clientProtocol: "openai-chat",
    });
  });
});
