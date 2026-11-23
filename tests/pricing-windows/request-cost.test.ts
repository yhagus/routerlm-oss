import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { upstreamModels } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { FakeUpstream, openAiChatFixture } from "@tests/support/fake-upstream.js";
import { insertApiKey, insertOpenAiChatModel } from "@tests/support/inference.js";
import { deleteAllPricingWindows, zoneAtNoonNow } from "@tests/support/pricing-windows.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";
import { writtenUsageLog } from "@tests/support/usage-logs.js";
import { untilUsageQueueIsDrained } from "@tests/support/usage-queue.js";

// Needs Redis at REDIS_URL. Its own Redis database keeps jobs that other test
// files enqueued (with no worker running) out of this worker's way.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import("@tests/support/test-app.js");
const { WorkerModule } = await import("@/worker.module.js");
const { USAGE_QUEUE } = await import("@/queue/models/queue-names.js");

const OPERATOR = { email: "ops@example.com", password: "ops password" };
const CHAT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hello" }] };

// The fixture reports 20 uncached input tokens, 40 output tokens and 100 cache reads.
// At the standard prices (2, 8, 0.5 per million) that is 0.00041.
const STANDARD_COST = 0.00041;

describe("Cost of a request in a Pricing Window (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let cookie: string;
  let apiKey: string;
  let providerId: string;
  let upstreamModelId: string;

  // In this zone the wall clock reads 12:xx right now.
  const { timeZone, today } = zoneAtNoonNow();
  const ACTIVE_NOW = [{ weekdays: [today], start: "11:00", end: "14:00" }];
  const NEVER_TODAY = [{ weekdays: [today === 1 ? 2 : 1], start: "00:00", end: "24:00" }];

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
    await deleteAllPricingWindows(db);
    ({ providerId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.baseUrl,
    }));
    [{ id: upstreamModelId }] = await db
      .update(upstreamModels)
      .set({ inputPrice: 2, outputPrice: 8, cacheReadPrice: 0.5, cacheWritePrice: 2.5 })
      .returning({ id: upstreamModels.id });
    await app.get(SnapshotService).changed();
    ({ key: apiKey } = await insertApiKey(app, db));
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  async function createWindow(name: string, ranges: object[], isEnabled = true): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/api/pricing-windows")
      .set("Cookie", cookie)
      .send({ name, timeZone, ranges, isEnabled })
      .expect(201);
    return created.body.id;
  }

  async function attachWindows(entries: object[]): Promise<void> {
    await request(app.getHttpServer())
      .put(`/api/upstream-models/${upstreamModelId}/pricing-windows`)
      .set("Cookie", cookie)
      .send(entries)
      .expect(200);
  }

  function upstreamAnswers(servedTierValue?: string): void {
    const answer: Record<string, unknown> = JSON.parse(
      openAiChatFixture("upstream-response-tool-call.json"),
    );
    upstream.reply({
      kind: "json",
      status: 200,
      body: servedTierValue === undefined ? answer : { ...answer, service_tier: servedTierValue },
    });
  }

  /** Sends a chat request and returns its Usage Log as the dashboard shows it. */
  async function chatAndWaitForUsageLog(body: object = CHAT_REQUEST) {
    upstreamAnswers();
    return chatAnsweredAndWaitForUsageLog(body);
  }

  async function chatAnsweredAndWaitForUsageLog(body: object = CHAT_REQUEST) {
    await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(body)
      .expect(200);
    const { id } = await writtenUsageLog(db);
    return shownUsageLog(id);
  }

  async function acceptFlexTier(): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/providers/${providerId}`)
      .set("Cookie", cookie)
      .send({ serviceTierValues: { flex: "flex" } })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/upstream-models/${upstreamModelId}`)
      .set("Cookie", cookie)
      .send({ serviceTiers: ["flex"], tierPrices: { flex: { inputPrice: 1, outputPrice: 4 } } })
      .expect(200);
  }

  async function shownUsageLog(id: string) {
    const shown = await request(app.getHttpServer())
      .get(`/api/usage/${id}`)
      .set("Cookie", cookie)
      .expect(200);
    return shown.body;
  }

  it("prices a request in an active window at its Window Prices, falling back to standard for a price left out", async () => {
    const offPeakId = await createWindow("Off-peak", ACTIVE_NOW);
    await attachWindows([{ pricingWindowId: offPeakId, inputPrice: 1, outputPrice: 4 }]);

    const usageLog = await chatAndWaitForUsageLog();

    // (20 x 1 + 40 x 4) at Window Prices, plus 100 cache reads x 0.5 at the standard price, per million.
    expect(usageLog.cost).toBeCloseTo(0.00023, 10);
    expect(usageLog.pricingWindowName).toBe("Off-peak");
    const listed = await request(app.getHttpServer())
      .get("/api/usage")
      .set("Cookie", cookie)
      .expect(200);
    expect(listed.body.items).toEqual([expect.objectContaining({ pricingWindowName: "Off-peak" })]);
  });

  it("prices at the standard prices when the window isn't active now", async () => {
    const weekendId = await createWindow("Weekend", NEVER_TODAY);
    await attachWindows([{ pricingWindowId: weekendId, inputPrice: 1, outputPrice: 4 }]);

    const usageLog = await chatAndWaitForUsageLog();

    expect(usageLog.cost).toBeCloseTo(STANDARD_COST, 10);
    expect(usageLog.pricingWindowName).toBeNull();
  });

  it("prices at the standard prices when the active window is disabled", async () => {
    const offPeakId = await createWindow("Off-peak", ACTIVE_NOW, false);
    await attachWindows([{ pricingWindowId: offPeakId, inputPrice: 1, outputPrice: 4 }]);

    const usageLog = await chatAndWaitForUsageLog();

    expect(usageLog.cost).toBeCloseTo(STANDARD_COST, 10);
    expect(usageLog.pricingWindowName).toBeNull();
  });

  it("prices at the one window that applies among the model's windows", async () => {
    const weekendId = await createWindow("Weekend", NEVER_TODAY);
    const happyHourId = await createWindow("Happy hour", ACTIVE_NOW);
    await attachWindows([
      { pricingWindowId: weekendId, inputPrice: 1, outputPrice: 4 },
      { pricingWindowId: happyHourId, inputPrice: 0.5, outputPrice: 1 },
    ]);

    const usageLog = await chatAndWaitForUsageLog();

    // (20 x 0.5 + 40 x 1 + 100 x 0.5) per million tokens.
    expect(usageLog.cost).toBeCloseTo(0.0001, 10);
    expect(usageLog.pricingWindowName).toBe("Happy hour");
  });

  it("ignores windows for a request served at a Service Tier", async () => {
    await acceptFlexTier();
    const happyHourId = await createWindow("Happy hour", ACTIVE_NOW);
    await attachWindows([{ pricingWindowId: happyHourId, inputPrice: 0.5, outputPrice: 1 }]);

    const usageLog = await chatAndWaitForUsageLog({ ...CHAT_REQUEST, service_tier: "flex" });

    // (20 x 1 + 40 x 4) at flex, plus 100 cache reads x 0.5 at the standard price, per million.
    expect(usageLog.cost).toBeCloseTo(0.00023, 10);
    expect(usageLog.pricingWindowName).toBeNull();
  });

  it("ignores windows when the upstream reports serving a tier nobody asked for", async () => {
    await acceptFlexTier();
    const happyHourId = await createWindow("Happy hour", ACTIVE_NOW);
    await attachWindows([{ pricingWindowId: happyHourId, inputPrice: 0.5, outputPrice: 1 }]);
    upstreamAnswers("flex");

    const usageLog = await chatAnsweredAndWaitForUsageLog();

    // (20 x 1 + 40 x 4) at flex, plus 100 cache reads x 0.5 at the standard price, per million.
    expect(usageLog.cost).toBeCloseTo(0.00023, 10);
    expect(usageLog.pricingWindowName).toBeNull();
  });

  it("prices at the active window when the upstream reports serving no tier over the one sent", async () => {
    await acceptFlexTier();
    const happyHourId = await createWindow("Happy hour", ACTIVE_NOW);
    await attachWindows([{ pricingWindowId: happyHourId, inputPrice: 0.5, outputPrice: 1 }]);
    upstreamAnswers("default");

    const usageLog = await chatAnsweredAndWaitForUsageLog({
      ...CHAT_REQUEST,
      service_tier: "flex",
    });

    // (20 x 0.5 + 40 x 1 + 100 x 0.5) per million tokens.
    expect(usageLog.cost).toBeCloseTo(0.0001, 10);
    expect(usageLog.pricingWindowName).toBe("Happy hour");
  });

  it("prices a Playground request in an active window at its Window Prices", async () => {
    const offPeakId = await createWindow("Off-peak", ACTIVE_NOW);
    await attachWindows([{ pricingWindowId: offPeakId, inputPrice: 1, outputPrice: 4 }]);
    // The Playground only streams; this stream reports the same tokens as the JSON answer.
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });

    await request(app.getHttpServer())
      .post("/api/playground/chat/completions")
      .set("Cookie", cookie)
      .send({ ...CHAT_REQUEST, stream: true })
      .expect(200);

    const { id } = await writtenUsageLog(db);
    const usageLog = await shownUsageLog(id);
    expect(usageLog).toMatchObject({ isPlayground: true, pricingWindowName: "Off-peak" });
    // (20 x 1 + 40 x 4) at Window Prices, plus 100 cache reads x 0.5 at the standard price, per million.
    expect(usageLog.cost).toBeCloseTo(0.00023, 10);
  });

  it("keeps the window's name and the Cost after the window is renamed, then deleted", async () => {
    const offPeakId = await createWindow("Off-peak", ACTIVE_NOW);
    await attachWindows([{ pricingWindowId: offPeakId, inputPrice: 1, outputPrice: 4 }]);
    const { id } = await chatAndWaitForUsageLog();

    await request(app.getHttpServer())
      .patch(`/api/pricing-windows/${offPeakId}`)
      .set("Cookie", cookie)
      .send({ name: "Night" })
      .expect(200);
    expect(await shownUsageLog(id)).toMatchObject({ pricingWindowName: "Off-peak" });
    await request(app.getHttpServer())
      .delete(`/api/pricing-windows/${offPeakId}`)
      .set("Cookie", cookie)
      .expect(204);

    const shown = await shownUsageLog(id);
    expect(shown.pricingWindowName).toBe("Off-peak");
    expect(shown.cost).toBeCloseTo(0.00023, 10);
  });
});
