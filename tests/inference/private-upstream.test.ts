import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { type FakeReply, FakeUpstream, openAiChatFixture } from "../support/fake-upstream.js";
import { eq } from "drizzle-orm";
import { providers } from "@/db/schemas/index.js";
import { insertApiKey, insertOpenAiChatModel, setProviderQuirks } from "../support/inference.js";
import { addOauthLoginAccount, offerOauthLogin } from "../support/kimi-oauth.js";
import { createTestApp } from "../support/test-app.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

const TEXT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };
const SUCCESS: FakeReply = {
  kind: "json",
  status: 200,
  body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
};

describe("Private upstreams at connect time (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    ({ providerId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.localhostBaseUrl,
    }));
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function chat() {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(TEXT_REQUEST);
  }

  it("refuses a hostname that resolves to loopback, without sending the credential", async () => {
    vi.stubEnv("ALLOW_PRIVATE_UPSTREAMS", "false");
    upstream.reply(SUCCESS);

    const response = await chat().expect(502);

    expect(response.body.error.code).toBe("upstream_error");
    expect(upstream.requests).toHaveLength(0);
  });

  it("refuses a stored plain http URL for a loopback address literal", async () => {
    vi.stubEnv("ALLOW_PRIVATE_UPSTREAMS", "false");
    await db
      .update(providers)
      .set({ baseUrl: upstream.baseUrl })
      .where(eq(providers.id, providerId));
    await app.get(SnapshotService).changed();
    upstream.reply(SUCCESS);

    const response = await chat().expect(502);

    expect(response.body.error.code).toBe("upstream_error");
    expect(upstream.requests).toHaveLength(0);
  });

  it("refuses to refresh an OAuth Login at an auth host that resolves to loopback", async () => {
    vi.stubEnv("ALLOW_PRIVATE_UPSTREAMS", "false");
    await offerOauthLogin(db, providerId, upstream.localhostBaseUrl.replace(/\/v1$/, ""));
    await addOauthLoginAccount(app, db, providerId, { lifetimeSeconds: 60, ageSeconds: 120 });
    upstream.reply(SUCCESS);

    await chat();

    expect(upstream.requests).toHaveLength(0);
  });

  it("connects to the same hostname when the deployment allows private upstreams", async () => {
    upstream.reply(SUCCESS);

    await chat().expect(200);

    expect(upstream.requests).toHaveLength(1);
  });

  it("serves a Provider whose stored quotaBaseUrl no longer passes the URL policy", async () => {
    await setProviderQuirks(app, db, providerId, { quotaBaseUrl: "http://quota.acme.example" });
    upstream.reply(SUCCESS);

    await chat().expect(200);
  });
});
