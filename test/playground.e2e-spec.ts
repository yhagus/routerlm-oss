import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import type { Queue } from "bullmq";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { upstreamModels } from "@/db/schemas/index.js";
import { USAGE_QUEUE } from "@/queue/models/queue-names.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import { FakeUpstream, openAiChatFixture } from "./support/fake-upstream.js";
import { insertOpenAiChatModel, UPSTREAM_MODEL_ID } from "./support/inference.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "./support/test-app.js";
import { deleteAllUpstreamData } from "./support/upstream.js";

const ADA = { email: "ada@example.com", password: "ada's password" };

const PLAYGROUND_REQUEST = {
  model: "smart",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What is in this picture?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      ],
    },
  ],
  stream: true,
};

describe("Playground (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let adaCookie: string;
  let adaId: string;
  let routeId: string;
  let providerAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
    const me = await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", adaCookie);
    adaId = me.body.id;
    ({ routeId, providerAccountId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.baseUrl,
    }));
    await db
      .update(upstreamModels)
      .set({ inputPrice: 2, outputPrice: 8, cacheReadPrice: 0.5, cacheWritePrice: 2.5 });
    await app.get(SnapshotService).changed();
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function sendToPlayground(body: object) {
    return request(app.getHttpServer())
      .post("/api/playground/chat/completions")
      .set("Cookie", adaCookie)
      .send(body);
  }

  it("streams the answer, then a summary of tokens, Cost, Route and Provider Account", async () => {
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });

    const response = await sendToPlayground(PLAYGROUND_REQUEST).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      model: UPSTREAM_MODEL_ID,
      messages: [{ role: "user", content: [{ type: "text" }, { type: "image_url" }] }],
    });
    expect(response.headers["content-type"]).toMatch(/^text\/event-stream/);
    const events = response.text.trim().split("\n\n");
    expect(events.at(-2)).toBe("data: [DONE]");
    const [summaryName, summaryData] = (events.at(-1) ?? "").split("\n");
    expect(summaryName).toBe("event: summary");
    const summary = JSON.parse(summaryData.slice("data: ".length));
    // The fixture reports 120 prompt tokens, 100 of them cache reads.
    expect(summary).toMatchObject({
      usage: {
        inputTokens: 20,
        outputTokens: 40,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
        reasoningTokens: 12,
      },
      route: { id: routeId, providerSlug: "acme-smart", upstreamModelId: UPSTREAM_MODEL_ID },
      providerAccount: { id: providerAccountId, name: "main" },
    });
    // (20 x 2 + 40 x 8 + 100 x 0.5) per million tokens.
    expect(summary.cost).toBeCloseTo(0.00041, 10);
  });

  it("records the request as the User's Playground usage", async () => {
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });
    const enqueued = vi.spyOn(app.get<Queue<UsageJob>>(getQueueToken(USAGE_QUEUE)), "add");

    await sendToPlayground(PLAYGROUND_REQUEST).expect(200);

    expect(enqueued).toHaveBeenCalledOnce();
    const [[, job]] = enqueued.mock.calls;
    expect(job.caller).toEqual({ kind: "playground", userId: adaId });
    expect(JSON.stringify(job)).not.toContain("What is in this picture?");
  });

  it("captures a failed request with the session cookie redacted", async () => {
    const enqueued = vi.spyOn(app.get<Queue<UsageJob>>(getQueueToken(USAGE_QUEUE)), "add");

    await sendToPlayground({ ...PLAYGROUND_REQUEST, model: "unknown" }).expect(404);

    const [[, job]] = enqueued.mock.calls;
    expect(job.caller).toEqual({ kind: "playground", userId: adaId });
    expect(job.errorCapture?.request.headers.cookie).toBe("[REDACTED]");
    expect(JSON.stringify(job.errorCapture)).not.toContain(adaCookie);
  });

  it("answers an error with our error code and message", async () => {
    const response = await sendToPlayground({ ...PLAYGROUND_REQUEST, model: "unknown" }).expect(
      404,
    );

    expect(response.body).toMatchObject({
      error: { code: "model_not_found", message: 'The Model "unknown" does not exist' },
    });
  });

  it("is only for signed-in Users", async () => {
    await request(app.getHttpServer())
      .post("/api/playground/chat/completions")
      .send(PLAYGROUND_REQUEST)
      .expect(401);
  });
});
