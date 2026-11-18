import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import { asc, eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import {
  apiKeys,
  attempts,
  errorCaptures,
  upstreamModels,
  usageLogs,
  users,
} from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { FakeUpstream, openAiChatFixture } from "../support/fake-upstream.js";
import {
  addProviderAccount,
  insertApiKey,
  insertOpenAiChatModel,
  setProviderQuirks,
  UPSTREAM_MODEL_ID,
} from "../support/inference.js";
import { portOf } from "../support/port-of.js";
import { deleteAllUpstreamData } from "../support/upstream.js";
import { untilUsageQueueIsDrained } from "../support/usage-queue.js";

// Needs Redis at REDIS_URL. Its own Redis database keeps jobs that other test
// files enqueued (with no worker running) out of this worker's way.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import("../support/test-app.js");
const { WorkerModule } = await import("@/worker.module.js");
const { USAGE_QUEUE } = await import("@/queue/models/queue-names.js");

const PROMPT_TEXT = "Which umbrella should I pack for Lisbon?";
const RESPONSE_TEXT = "Checking the weather.";
const CHAT_REQUEST = { model: "smart", messages: [{ role: "user", content: PROMPT_TEXT }] };
const WORKER_WRITE_TIMEOUT_MS = 5_000;
// 1,000 uncached input tokens, 10,000 cache reads and 2,000 cache writes, in OpenAI's shape.
const FULL_USAGE = {
  prompt_tokens: 13_000,
  completion_tokens: 500,
  prompt_tokens_details: { cached_tokens: 10_000, cache_creation_input_tokens: 2_000 },
  completion_tokens_details: { reasoning_tokens: 100 },
};
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
  let firstAccountId: string;
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
    ({
      modelId,
      routeId,
      providerId,
      providerAccountId: firstAccountId,
    } = await insertOpenAiChatModel(app, db, {
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

  /** Queues a successful upstream answer reporting `usage`. */
  function upstreamAnswersWithUsage(usage: object): void {
    const answer: Record<string, unknown> = JSON.parse(
      openAiChatFixture("upstream-response-tool-call.json"),
    );
    upstream.reply({ kind: "json", status: 200, body: { ...answer, usage } });
  }

  async function removeCacheWritePrice(): Promise<void> {
    await db
      .update(upstreamModels)
      .set({ cacheWritePrice: null })
      .where(eq(upstreamModels.id, upstreamModelId));
    await app.get(SnapshotService).changed();
  }

  it("prices input, output, cache reads and cache writes at the Upstream Model's prices", async () => {
    upstreamAnswersWithUsage(FULL_USAGE);

    await chat(CHAT_REQUEST).expect(200);

    const { usageLog } = await writtenUsageLog();
    expect(usageLog).toMatchObject({
      inputTokens: 1_000,
      cacheReadTokens: 10_000,
      cacheWriteTokens: 2_000,
      reasoningTokens: 100,
      isIncomplete: false,
    });
    // (1000 x 2 + 500 x 8 + 10000 x 0.5 + 2000 x 2.5) per million tokens.
    expect(usageLog.cost).toBeCloseTo(0.016, 10);
  });

  it("leaves an unreported count empty, flags the Usage Log incomplete and prices only what was reported", async () => {
    upstreamAnswersWithUsage({
      prompt_tokens: 3_000,
      completion_tokens: 500,
      prompt_tokens_details: { cache_creation_input_tokens: 2_000 },
      completion_tokens_details: { reasoning_tokens: 100 },
    });

    await chat(CHAT_REQUEST).expect(200);

    const { usageLog } = await writtenUsageLog();
    expect(usageLog).toMatchObject({
      inputTokens: 1_000,
      cacheReadTokens: null,
      isIncomplete: true,
    });
    // (1000 x 2 + 500 x 8 + 2000 x 2.5) per million tokens.
    expect(usageLog.cost).toBeCloseTo(0.011, 10);
  });

  it("does not flag a missing reasoning count, which only splits the output count", async () => {
    const { completion_tokens_details: _reasoning, ...withoutReasoning } = FULL_USAGE;
    upstreamAnswersWithUsage(withoutReasoning);

    await chat(CHAT_REQUEST).expect(200);

    const { usageLog } = await writtenUsageLog();
    expect(usageLog).toMatchObject({ reasoningTokens: null, isIncomplete: false });
  });

  it("leaves the Cost unknown when tokens were used at a price nobody entered", async () => {
    await removeCacheWritePrice();
    upstreamAnswersWithUsage(FULL_USAGE);

    await chat(CHAT_REQUEST).expect(200);

    const { usageLog } = await writtenUsageLog();
    expect(usageLog.cost).toBeNull();
  });

  it("needs no price for a count of zero", async () => {
    await removeCacheWritePrice();
    upstreamAnswersWithUsage({
      ...FULL_USAGE,
      prompt_tokens: 11_000,
      prompt_tokens_details: { cached_tokens: 10_000, cache_creation_input_tokens: 0 },
    });

    await chat(CHAT_REQUEST).expect(200);

    const { usageLog } = await writtenUsageLog();
    // (1000 x 2 + 500 x 8 + 10000 x 0.5) per million tokens.
    expect(usageLog.cost).toBeCloseTo(0.011, 10);
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

  it("stores no prompt or response content in the Usage Log or its Attempts", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await chat(CHAT_REQUEST).expect(200);

    const stored = JSON.stringify(await writtenUsageLog());
    expect(stored).not.toContain(PROMPT_TEXT);
    expect(stored).not.toContain(RESPONSE_TEXT);
    expect(stored).not.toContain("Paris");
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

  it("records a Provider Account skipped as Exhausted as an Attempt with no upstream call", async () => {
    const secondAccountId = await addProviderAccount(app, db, providerId, {
      key: "sk-second-account",
      priority: 1,
    });
    await setProviderQuirks(app, db, providerId, { exhaustedErrorCodes: [2056] });
    const answer = JSON.parse(openAiChatFixture("upstream-response-tool-call.json"));
    // The first request's refusal makes the first account Exhausted.
    upstream.reply({
      kind: "json",
      status: 429,
      body: { base_resp: { status_code: 2056, status_msg: "usage limit exceeded" } },
    });
    upstream.reply({ kind: "json", status: 200, body: answer });
    await chat(CHAT_REQUEST).expect(200);
    await writtenUsageLog();
    await db.delete(usageLogs);
    upstream.reply({ kind: "json", status: 200, body: answer });

    await chat(CHAT_REQUEST).expect(200);

    const written = await writtenUsageLog();
    expect(written.usageLog).toMatchObject({ providerAccountId: secondAccountId });
    expect(written.attempts).toEqual([
      expect.objectContaining({
        providerAccountId: firstAccountId,
        upstreamStatus: null,
        failureReason: "exhausted",
        durationMs: 0,
      }),
      expect.objectContaining({ providerAccountId: secondAccountId, failureReason: null }),
    ]);
    expect(upstream.requests).toHaveLength(3);
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
      outputTokens: null,
      cost: null,
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
      inputTokens: null,
      outputTokens: null,
      cost: null,
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

  describe("as a snapshot of what served the request", () => {
    let cookie: string;

    beforeEach(async () => {
      cookie = await setUpFirstUser(app, { email: "ops@example.com", password: "ops password" });
    });

    function dashboard() {
      return request(app.getHttpServer());
    }

    /** Waits until the worker wrote `count` Usage Logs, and returns them oldest first. */
    async function writtenUsageLogs(count: number) {
      const deadline = Date.now() + WORKER_WRITE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const written = await db.select().from(usageLogs).orderBy(asc(usageLogs.createdAt));
        if (written.length === count) {
          return written;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      throw new Error(`The worker did not write ${count} Usage Logs`);
    }

    function upstreamAnswers(): void {
      upstream.reply({
        kind: "json",
        status: 200,
        body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
      });
    }

    it("copies the names of what served it onto the Usage Log and each Attempt", async () => {
      const secondAccountId = await addProviderAccount(app, db, providerId, {
        key: "sk-second-account",
        priority: 1,
      });
      upstream.reply({ kind: "json", status: 500, body: { error: { message: "down" } } });
      upstreamAnswers();

      await chat(CHAT_REQUEST).expect(200);

      const written = await writtenUsageLog();
      expect(written.usageLog).toMatchObject({
        modelName: "smart",
        apiKeyName: "client",
        upstreamModelId,
        upstreamModelName: UPSTREAM_MODEL_ID,
        providerSlug: "acme-smart",
        providerAccountId: secondAccountId,
        providerAccountName: "account 1",
      });
      expect(written.attempts).toEqual([
        expect.objectContaining({
          modelName: "smart",
          apiKeyName: "client",
          upstreamModelId,
          upstreamModelName: UPSTREAM_MODEL_ID,
          providerSlug: "acme-smart",
          providerAccountId: firstAccountId,
          providerAccountName: "main",
        }),
        expect.objectContaining({
          providerAccountId: secondAccountId,
          providerAccountName: "account 1",
        }),
      ]);
    });

    it("keeps its ids and names after the API Key, Model, Route and Provider Account are deleted", async () => {
      upstreamAnswers();
      await chat(CHAT_REQUEST).expect(200);
      const before = await writtenUsageLog();

      await dashboard()
        .delete(`/api/models/${modelId}/routes/${routeId}`)
        .set("Cookie", cookie)
        .expect(204);
      await dashboard().delete(`/api/models/${modelId}`).set("Cookie", cookie).expect(204);
      await dashboard()
        .delete(`/api/provider-accounts/${firstAccountId}`)
        .set("Cookie", cookie)
        .expect(204);
      await db.delete(apiKeys).where(eq(apiKeys.id, apiKeyId));

      const after = await writtenUsageLog();
      expect(after.usageLog).toEqual(before.usageLog);
      expect(after.usageLog).toMatchObject({
        apiKeyId,
        apiKeyName: "client",
        modelId,
        modelName: "smart",
        routeId,
        providerAccountId: firstAccountId,
        providerAccountName: "main",
      });
      expect(after.attempts).toEqual(before.attempts);
    });

    it("keeps the earlier names after the Model and API Key are renamed, and still finds them by id", async () => {
      upstreamAnswers();
      await chat(CHAT_REQUEST).expect(200);
      await writtenUsageLogs(1);
      await dashboard()
        .patch(`/api/models/${modelId}`)
        .set("Cookie", cookie)
        .send({ name: "clever" })
        .expect(200);
      await db.update(apiKeys).set({ name: "renamed" }).where(eq(apiKeys.id, apiKeyId));
      await app.get(SnapshotService).changed();
      upstreamAnswers();

      await chat({ ...CHAT_REQUEST, model: "clever" }).expect(200);

      const [earlier, later] = await writtenUsageLogs(2);
      expect(earlier).toMatchObject({ modelName: "smart", apiKeyName: "client" });
      expect(later).toMatchObject({ modelName: "clever", apiKeyName: "renamed" });
      const listed = await dashboard()
        .get(`/api/usage?modelId=${modelId}&apiKeyId=${apiKeyId}`)
        .set("Cookie", cookie)
        .expect(200);
      expect(listed.body.items).toEqual([
        expect.objectContaining({ modelName: "clever", apiKeyName: "renamed" }),
        expect.objectContaining({ modelName: "smart", apiKeyName: "client" }),
      ]);
    });

    it("keeps the Upstream Model that served it after the Route is pointed at another", async () => {
      const [{ id: otherUpstreamModelId }] = await db
        .insert(upstreamModels)
        .values({ providerId, upstreamModelId: "acme-small-2026", contextSize: 128_000 })
        .returning({ id: upstreamModels.id });
      upstreamAnswers();
      await chat(CHAT_REQUEST).expect(200);
      await writtenUsageLogs(1);

      await dashboard()
        .patch(`/api/models/${modelId}/routes/${routeId}`)
        .set("Cookie", cookie)
        .send({ upstreamModelId: otherUpstreamModelId })
        .expect(200);

      const [usageLog] = await writtenUsageLogs(1);
      expect(usageLog).toMatchObject({ upstreamModelId, upstreamModelName: UPSTREAM_MODEL_ID });
    });

    it("keeps only the User's id for a Playground request", async () => {
      upstream.reply({
        kind: "stream",
        events: openAiChatFixture("upstream-stream-tool-call.sse"),
      });

      await dashboard()
        .post("/api/playground/chat/completions")
        .set("Cookie", cookie)
        .send({ ...CHAT_REQUEST, stream: true })
        .expect(200);

      const [usageLog] = await writtenUsageLogs(1);
      const [ops] = await db.select({ id: users.id }).from(users);
      expect(usageLog).toMatchObject({
        userId: ops.id,
        isPlayground: true,
        apiKeyId: null,
        apiKeyName: null,
        modelName: "smart",
      });
    });

    it("deletes its Attempts and Error Captures with it", async () => {
      await addProviderAccount(app, db, providerId, { key: "sk-second-account", priority: 1 });
      upstream.reply({ kind: "json", status: 500, body: { error: { message: "down" } } });
      upstreamAnswers();
      await chat(CHAT_REQUEST).expect(200);
      await writtenUsageLog();
      expect(await db.select().from(errorCaptures)).toHaveLength(1);

      await db.delete(usageLogs);

      expect(await db.select().from(attempts)).toEqual([]);
      expect(await db.select().from(errorCaptures)).toEqual([]);
    });
  });

  describe("with Service Tiers", () => {
    let cookie: string;

    beforeEach(async () => {
      cookie = await setUpFirstUser(app, { email: "ops@example.com", password: "ops password" });
      await request(app.getHttpServer())
        .patch(`/api/providers/${providerId}`)
        .set("Cookie", cookie)
        .send({ serviceTierValues: { fast: "priority", flex: "flex" } })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/upstream-models/${upstreamModelId}`)
        .set("Cookie", cookie)
        .send({
          serviceTiers: ["fast", "flex"],
          tierPrices: { flex: { inputPrice: 1, outputPrice: 4 } },
        })
        .expect(200);
    });

    it("records the tier sent and prices it at that tier, falling back to standard prices", async () => {
      upstream.reply({
        kind: "json",
        status: 200,
        body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
      });

      await chat({ ...CHAT_REQUEST, service_tier: "flex" }).expect(200);

      const { usageLog } = await writtenUsageLog();
      // (20 x 1 + 40 x 4) at flex, plus 100 cache reads x 0.5 at the standard price, per million.
      expect(usageLog.cost).toBeCloseTo(0.00023, 10);
      const listed = await request(app.getHttpServer())
        .get("/api/usage")
        .set("Cookie", cookie)
        .expect(200);
      expect(listed.body.items).toEqual([expect.objectContaining({ serviceTier: "flex" })]);
    });

    it("records the tier the upstream reports serving over the one sent", async () => {
      const answer: Record<string, unknown> = JSON.parse(
        openAiChatFixture("upstream-response-tool-call.json"),
      );
      upstream.reply({
        kind: "json",
        status: 200,
        body: { ...answer, usage: FULL_USAGE, service_tier: "default" },
      });

      await chat({ ...CHAT_REQUEST, service_tier: "flex" }).expect(200);

      const { usageLog } = await writtenUsageLog();
      expect(usageLog.serviceTier).toBeNull();
      // Standard prices: (1000 x 2 + 500 x 8 + 10000 x 0.5 + 2000 x 2.5) per million tokens.
      expect(usageLog.cost).toBeCloseTo(0.016, 10);
    });
  });
});
