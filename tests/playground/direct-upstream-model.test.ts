import { randomUUID } from "node:crypto";
import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import type { Queue } from "bullmq";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { models, routes, upstreamModels } from "@/db/schemas/index.js";
import { USAGE_QUEUE } from "@/queue/models/queue-names.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import { FakeUpstream, openAiChatFixture } from "@tests/support/fake-upstream.js";
import {
  addProviderAccount,
  insertOpenAiChatModel,
  UPSTREAM_KEY,
  UPSTREAM_MODEL_ID,
} from "@tests/support/inference.js";
import {
  ACCESS_TOKEN,
  addOauthLoginAccount,
  DEVICE_ID,
  offerOauthLogin,
} from "@tests/support/kimi-oauth.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const BACKUP_KEY = "sk-backup-secret-9876543210";

/** As the web sends it: the Upstream Model's own id in `model`, which resolution ignores. */
const DIRECT_REQUEST = {
  model: UPSTREAM_MODEL_ID,
  messages: [{ role: "user", content: "Hello there" }],
  temperature: 0.7,
  stream: true,
};

describe("Playground, direct Upstream Model test (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let adaCookie: string;
  let adaId: string;
  let providerId: string;
  let providerAccountId: string;
  let upstreamModelRowId: string;

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
    ({ providerId, providerAccountId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.baseUrl,
      capabilities: ["tools"],
    }));
    [{ id: upstreamModelRowId }] = await db.select({ id: upstreamModels.id }).from(upstreamModels);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function sendDirect(upstreamModelId: string, body: object = DIRECT_REQUEST) {
    return request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelId}/chat/completions`)
      .set("Cookie", adaCookie)
      .send(body);
  }

  function summaryOf(eventStream: string): unknown {
    const [summaryName, summaryData] = (eventStream.trim().split("\n\n").at(-1) ?? "").split("\n");
    expect(summaryName).toBe("event: summary");
    return JSON.parse(summaryData.slice("data: ".length));
  }

  function replyWithStream(): void {
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });
  }

  it("tests an Upstream Model with a Provider Account holding an OAuth Login", async () => {
    await offerOauthLogin(db, providerId, upstream.origin);
    await addOauthLoginAccount(app, db, providerId, { lifetimeSeconds: 3600 });
    replyWithStream();

    await sendDirect(upstreamModelRowId).expect(200);

    expect(upstream.requests).toHaveLength(1);
    expect(upstream.lastRequest.headers).toMatchObject({
      authorization: `Bearer ${ACCESS_TOKEN}`,
      "x-msh-device-id": DEVICE_ID,
    });
  });

  it("streams the answer from an Upstream Model no Route uses, then a summary without a Route", async () => {
    await db.delete(routes);
    await app.get(SnapshotService).changed();
    replyWithStream();

    const response = await sendDirect(upstreamModelRowId).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ model: UPSTREAM_MODEL_ID });
    expect(response.text).toContain("data: [DONE]");
    expect(summaryOf(response.text)).toMatchObject({
      route: null,
      upstreamModel: {
        id: upstreamModelRowId,
        upstreamModelId: UPSTREAM_MODEL_ID,
        providerSlug: "acme-smart",
      },
      providerAccount: { id: providerAccountId, name: "main" },
    });
  });

  it("falls back to the Provider's next enabled Provider Account when the first fails", async () => {
    const backupAccountId = await addProviderAccount(app, db, providerId, {
      key: BACKUP_KEY,
      priority: 1,
    });
    upstream.reply({ kind: "json", status: 500, body: { error: "down" } });
    replyWithStream();

    const response = await sendDirect(upstreamModelRowId).expect(200);

    expect(upstream.requests.map((sent) => sent.headers.authorization)).toEqual([
      `Bearer ${UPSTREAM_KEY}`,
      `Bearer ${BACKUP_KEY}`,
    ]);
    expect(summaryOf(response.text)).toMatchObject({
      providerAccount: { id: backupAccountId, name: "account 1" },
    });
  });

  it("sends the request as it came, without the Parameter Policy of a Model routing there", async () => {
    await db
      .update(models)
      .set({ parameterPolicy: { forced: { temperature: 0 }, systemPrompt: "Model prompt" } });
    await app.get(SnapshotService).changed();
    replyWithStream();

    await sendDirect(upstreamModelRowId).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      temperature: 0.7,
      messages: [{ role: "user", content: "Hello there" }],
    });
  });

  it("refuses a request the Upstream Model lacks a Capability for", async () => {
    const response = await sendDirect(upstreamModelRowId, {
      ...DIRECT_REQUEST,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
          ],
        },
      ],
    }).expect(400);

    expect(response.body).toMatchObject({ error: { code: "no_capable_route" } });
    expect(upstream.requests).toEqual([]);
  });

  it("answers model_not_found for an unknown or disabled Upstream Model", async () => {
    await sendDirect(randomUUID()).expect(404);
    await db.update(upstreamModels).set({ isEnabled: false });
    await app.get(SnapshotService).changed();

    const response = await sendDirect(upstreamModelRowId).expect(404);

    expect(response.body).toMatchObject({ error: { code: "model_not_found" } });
    expect(upstream.requests).toEqual([]);
  });

  it("records the request as the User's Playground usage, with no Model", async () => {
    replyWithStream();
    const enqueued = vi.spyOn(app.get<Queue<UsageJob>>(getQueueToken(USAGE_QUEUE)), "add");

    await sendDirect(upstreamModelRowId).expect(200);

    const [[, job]] = enqueued.mock.calls;
    expect(job).toMatchObject({
      caller: { kind: "playground", userId: adaId },
      modelId: null,
      servedBy: { routeId: null, upstreamModelId: upstreamModelRowId, providerAccountId },
    });
  });

  it("is only for signed-in Users", async () => {
    await request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelRowId}/chat/completions`)
      .send(DIRECT_REQUEST)
      .expect(401);
  });
});
