import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys, upstreamModels } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { createApiKey } from "../support/api-keys.js";
import { FakeUpstream, openAiChatFixture } from "../support/fake-upstream.js";
import { insertOpenAiChatModel } from "../support/inference.js";
import { createIntegration } from "../support/integrations.js";
import { deleteAllUpstreamData } from "../support/upstream.js";
import { writtenUsageLogs } from "../support/usage-logs.js";
import { untilUsageQueueIsDrained } from "../support/usage-queue.js";

// Needs Redis at REDIS_URL. Its own Redis database keeps jobs that other test
// files enqueued (with no worker running) out of this worker's way.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import("../support/test-app.js");
const { WorkerModule } = await import("@/worker.module.js");
const { USAGE_QUEUE } = await import("@/queue/models/queue-names.js");

const ADA = { email: "ada@example.com", password: "ada's password" };
// 160 tokens at 1000 USD per million tokens each way: one request costs 0.16 USD.
const PRICE_PER_MILLION_TOKENS = 1000;
const REPORTED_USAGE = { prompt_tokens: 120, completion_tokens: 40 };
const REQUEST_COST = 0.16;

describe("Spend Limit of an API Key (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let adaCookie: string;
  let acme: { id: string; secret: string };

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
    await db.execute(sql`truncate table integrations, api_keys, usage_logs cascade`);
    await insertOpenAiChatModel(app, db, { modelName: "smart", baseUrl: upstream.baseUrl });
    await db.update(upstreamModels).set({
      inputPrice: PRICE_PER_MILLION_TOKENS,
      outputPrice: PRICE_PER_MILLION_TOKENS,
      cacheReadPrice: PRICE_PER_MILLION_TOKENS,
    });
    await app.get(SnapshotService).changed();
    adaCookie = await setUpFirstUser(app, ADA);
    acme = await createIntegration(app, adaCookie, { name: "Acme SaaS" });
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  function controlPlane() {
    const server = app.getHttpServer();
    const withSecret = (test: request.Test) => test.set("Authorization", `Bearer ${acme.secret}`);
    return {
      issueKey: async (spendLimit: number | null): Promise<{ id: string; key: string }> => {
        const created = await withSecret(request(server).post("/integration/v1/keys"))
          .send({ customerId: "cus_42", spendLimit })
          .expect(201);
        return { id: created.body.apiKey.id, key: created.body.key };
      },
      spentBy: async (id: string): Promise<number> => {
        const found = await withSecret(request(server).get(`/integration/v1/keys/${id}`)).expect(
          200,
        );
        return found.body.spent;
      },
      setSpendLimit: (id: string, spendLimit: number | null) =>
        withSecret(request(server).patch(`/integration/v1/keys/${id}`))
          .send({ spendLimit })
          .expect(200),
    };
  }

  function chat(key: string, body: object = {}) {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${key}`)
      .send({ model: "smart", messages: [{ role: "user", content: "Hello" }], ...body });
  }

  function upstreamAnswers(): void {
    const answer: Record<string, unknown> = JSON.parse(
      openAiChatFixture("upstream-response-tool-call.json"),
    );
    upstream.reply({ kind: "json", status: 200, body: { ...answer, usage: REPORTED_USAGE } });
  }

  /** One served request, counted by the worker. */
  async function spendOneRequest(key: string): Promise<void> {
    upstreamAnswers();
    await chat(key).expect(200);
    await untilUsageQueueIsDrained(usageQueue);
  }

  it("counts each request's Cost as spent, then refuses the key with 402 once its Spend Limit is reached", async () => {
    const { id, key } = await controlPlane().issueKey(0.2);

    await spendOneRequest(key);
    expect(await controlPlane().spentBy(id)).toBeCloseTo(REQUEST_COST);
    await spendOneRequest(key);
    const refused = await chat(key).expect(402);
    await untilUsageQueueIsDrained(usageQueue);

    expect(refused.body.error).toMatchObject({ code: "spend_limit_reached" });
    expect(await controlPlane().spentBy(id)).toBeCloseTo(2 * REQUEST_COST);
    expect(upstream.requests).toHaveLength(2);
    const logs = await writtenUsageLogs(db);
    expect(logs.filter((log) => log.httpStatus === 402)).toEqual([
      expect.objectContaining({
        apiKeyId: id,
        errorCode: "spend_limit_reached",
        errorOrigin: "client",
        customerId: "cus_42",
      }),
    ]);
  });

  it("serves the key again as soon as the Integration raises its Spend Limit", async () => {
    const { id, key } = await controlPlane().issueKey(0.1);
    await spendOneRequest(key);
    await chat(key).expect(402);

    await controlPlane().setSpendLimit(id, 1);

    upstreamAnswers();
    await chat(key).expect(200);
  });

  it("lets a stream that starts under the Spend Limit finish past it", async () => {
    const { key } = await controlPlane().issueKey(0.1);
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });

    const streamed = await chat(key, { stream: true }).expect(200);
    await untilUsageQueueIsDrained(usageQueue);

    expect(streamed.text.trim().endsWith("data: [DONE]")).toBe(true);
    await chat(key).expect(402);
  });

  it("refuses a key already over its Spend Limit even when no flag says so", async () => {
    const { id, key } = await controlPlane().issueKey(1);
    // Spent without the worker, so nothing ever flagged the key.
    await db.update(apiKeys).set({ spent: 5 }).where(eq(apiKeys.id, id));

    await chat(key).expect(402);
  });

  it("counts a retried usage job's Cost once", async () => {
    const { id, key } = await controlPlane().issueKey(1);
    await usageQueue.pause();
    upstreamAnswers();
    await chat(key).expect(200);
    const [job] = await usageQueue.getWaiting();
    await usageQueue.add(job.name, job.data);

    await usageQueue.resume();
    await untilUsageQueueIsDrained(usageQueue);

    expect(await controlPlane().spentBy(id)).toBeCloseTo(REQUEST_COST);
  });

  it("adds nothing for a request whose Cost is unknown", async () => {
    const { id, key } = await controlPlane().issueKey(0.1);
    const answer: Record<string, unknown> = JSON.parse(
      openAiChatFixture("upstream-response-tool-call.json"),
    );
    upstream.reply({ kind: "json", status: 200, body: { ...answer, usage: undefined } });

    await chat(key).expect(200);
    await untilUsageQueueIsDrained(usageQueue);

    expect(await controlPlane().spentBy(id)).toBe(0);
  });

  it("refuses on every client Protocol in that Protocol's error body, and records each refusal", async () => {
    const { key } = await controlPlane().issueKey(0);
    const server = app.getHttpServer();

    const messages = await request(server)
      .post("/v1/messages")
      .set("x-api-key", key)
      .send({ model: "smart", max_tokens: 16, messages: [{ role: "user", content: "Hello" }] })
      .expect(402);
    const images = await request(server)
      .post("/v1/images/generations")
      .set("Authorization", `Bearer ${key}`)
      .send({ model: "smart", prompt: "A lighthouse" })
      .expect(402);
    await untilUsageQueueIsDrained(usageQueue);

    expect(messages.body).toEqual({
      type: "error",
      error: expect.objectContaining({ type: "billing_error", code: "spend_limit_reached" }),
    });
    expect(images.body.error).toMatchObject({ code: "spend_limit_reached" });
    const logs = await writtenUsageLogs(db);
    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientProtocol: "anthropic-messages",
          errorCode: "spend_limit_reached",
          errorOrigin: "client",
        }),
        expect.objectContaining({
          clientProtocol: "openai-images",
          errorCode: "spend_limit_reached",
          errorOrigin: "client",
        }),
      ]),
    );
  });

  it("lets a User set and clear the Spend Limit of an operator key, and shows what it spent", async () => {
    const server = app.getHttpServer();
    const { id, key } = await createApiKey(app, adaCookie);
    const editSpendLimit = (spendLimit: number | null) =>
      request(server)
        .patch(`/api/api-keys/${id}`)
        .set("Cookie", adaCookie)
        .send({ spendLimit })
        .expect(200);

    const limited = await editSpendLimit(0);
    await chat(key).expect(402);
    await editSpendLimit(null);
    upstreamAnswers();
    await chat(key).expect(200);
    await untilUsageQueueIsDrained(usageQueue);

    expect(limited.body).toMatchObject({ spendLimit: 0, spent: 0 });
    const listed = await request(server).get("/api/api-keys").set("Cookie", adaCookie).expect(200);
    expect(listed.body).toEqual([expect.objectContaining({ id, spendLimit: null })]);
    expect(listed.body[0].spent).toBeCloseTo(REQUEST_COST);
  });
});
