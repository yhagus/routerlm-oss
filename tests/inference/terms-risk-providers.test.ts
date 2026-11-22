import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { providers, settings, upstreamModels } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { type FakeReply, FakeUpstream } from "@tests/support/fake-upstream.js";
import { ALL_CAPABILITIES, insertApiKey, insertOpenAiChatModel } from "@tests/support/inference.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };
const TEXT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };
const COMPLETION: FakeReply = {
  kind: "json",
  status: 200,
  body: {
    id: "chatcmpl-1",
    object: "chat.completion",
    model: "acme-large-2026",
    choices: [
      { index: 0, message: { role: "assistant", content: "Hello." }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 2 },
  },
};

const COMPLETION_STREAM: FakeReply = {
  kind: "stream",
  events: [
    { choices: [{ index: 0, delta: { role: "assistant", content: "Hello." } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .concat("data: [DONE]\n\n")
    .join(""),
};

describe("A Terms Risk Provider is unusable unless a User allows it (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let cookie: string;
  let apiKey: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    upstream.reply(COMPLETION);
    await deleteAllUpstreamData(db);
    await db.delete(settings).where(eq(settings.key, "allowTermsRiskProviders"));
    cookie = await setUpFirstUser(app, OPERATOR);
    ({ providerId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.baseUrl,
    }));
    await db.update(providers).set({ termsRisk: true }).where(eq(providers.id, providerId));
    await app.get(SnapshotService).changed();
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function allowTermsRiskProviders(allowed: boolean) {
    return request(app.getHttpServer())
      .put("/api/settings/terms-risk-providers")
      .set("Cookie", cookie)
      .send({ allowed })
      .expect(200);
  }

  function chat() {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(TEXT_REQUEST);
  }

  /** What /v1/models says "smart" can do; a Model with no usable Route offers nothing. */
  async function offeredCapabilities(): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .get("/v1/models")
      .set("Authorization", `Bearer ${apiKey}`)
      .expect(200);
    return response.body.data[0].capabilities;
  }

  async function playgroundDirectCallStatus(): Promise<number> {
    const [upstreamModel] = await db
      .select({ id: upstreamModels.id })
      .from(upstreamModels)
      .where(eq(upstreamModels.providerId, providerId));
    const response = await request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModel.id}/chat/completions`)
      .set("Cookie", cookie)
      .send({ model: "acme", stream: true, messages: [{ role: "user", content: "Hi" }] });
    return response.status;
  }

  async function storedIsEnabled(): Promise<boolean> {
    const [provider] = await db
      .select({ isEnabled: providers.isEnabled })
      .from(providers)
      .where(eq(providers.id, providerId));
    return provider.isEnabled;
  }

  it("serves nothing, lists nothing and stays enabled while the Setting is off", async () => {
    await chat().expect(400);
    expect(await playgroundDirectCallStatus()).toBe(404);

    expect(await offeredCapabilities()).toEqual([]);
    expect(upstream.requests).toHaveLength(0);
    expect(await storedIsEnabled()).toBe(true);
  });

  it("serves and lists the Provider as soon as a User allows it, and stops again when they block it", async () => {
    await allowTermsRiskProviders(true);

    await chat().expect(200);
    upstream.reply(COMPLETION_STREAM);
    expect(await playgroundDirectCallStatus()).toBe(200);
    expect(await offeredCapabilities()).toEqual(ALL_CAPABILITIES);

    await allowTermsRiskProviders(false);

    await chat().expect(400);
    expect(await offeredCapabilities()).toEqual([]);
    expect(await storedIsEnabled()).toBe(true);
  });
});
