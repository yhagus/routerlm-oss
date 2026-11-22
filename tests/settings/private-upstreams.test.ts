import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import { settings } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { type FakeReply, FakeUpstream, openAiChatFixture } from "@tests/support/fake-upstream.js";
import { insertApiKey, insertOpenAiChatModel } from "@tests/support/inference.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const REFUSED_BY_DEFAULT = { allowed: false, defaultAllowed: false, isDefault: true };
const SUCCESS: FakeReply = {
  kind: "json",
  status: 200,
  body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
};

describe("Allow private upstreams setting (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    await db.delete(settings).where(eq(settings.key, "allowPrivateUpstreams"));
    await app.get(SnapshotService).changed();
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function settingRequest(method: "get" | "put" | "delete") {
    return request(app.getHttpServer())
      [method]("/api/settings/private-upstreams")
      .set("Cookie", adaCookie);
  }

  function createPrivateProvider(slug: string) {
    return request(app.getHttpServer())
      .post("/api/providers")
      .set("Cookie", adaCookie)
      .send({
        slug,
        name: slug,
        endpoints: [{ kind: "chat", protocol: "openai-chat", baseUrl: "http://192.168.1.10/v1" }],
        authStyle: "bearer",
      });
  }

  it("refuses private upstreams until a User allows them", async () => {
    const response = await settingRequest("get").expect(200);

    expect(response.body).toEqual(REFUSED_BY_DEFAULT);
  });

  it("saves the choice, shows it afterwards and returns to the default when reset", async () => {
    const saved = await settingRequest("put").send({ allowed: true }).expect(200);
    const shown = await settingRequest("get").expect(200);
    const reset = await settingRequest("delete").expect(200);
    const shownAfterReset = await settingRequest("get").expect(200);

    const allowed = { allowed: true, defaultAllowed: false, isDefault: false };
    expect(saved.body).toEqual(allowed);
    expect(shown.body).toEqual(allowed);
    expect(reset.body).toEqual(REFUSED_BY_DEFAULT);
    expect(shownAfterReset.body).toEqual(REFUSED_BY_DEFAULT);
  });

  it("rejects a body that is not a boolean", async () => {
    await settingRequest("put").send({ allowed: "yes" }).expect(400);

    expect((await settingRequest("get")).body).toEqual(REFUSED_BY_DEFAULT);
  });

  it("refuses a private Provider URL again, at write and connect time, once turned back off", async () => {
    await settingRequest("put").send({ allowed: true }).expect(200);
    await createPrivateProvider("lan-ollama").expect(201);
    await insertOpenAiChatModel(app, db, { modelName: "smart", baseUrl: upstream.baseUrl });
    const { key: apiKey } = await insertApiKey(app, db);
    upstream.reply(SUCCESS);
    const chat = () =>
      request(app.getHttpServer())
        .post("/v1/chat/completions")
        .set("Authorization", `Bearer ${apiKey}`)
        .send({ model: "smart", messages: [{ role: "user", content: "Hi" }] });
    await chat().expect(200);

    await settingRequest("put").send({ allowed: false }).expect(200);

    const refusedWrite = await createPrivateProvider("lan-vllm").expect(400);
    const refusedConnect = await chat().expect(502);
    expect(JSON.stringify(refusedWrite.body)).toContain("Allow private upstreams");
    expect(refusedConnect.body.error.code).toBe("upstream_error");
    expect(upstream.requests).toHaveLength(1);
  });
});
