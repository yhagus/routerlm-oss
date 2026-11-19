import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { dashScopeImageFixture, FakeUpstream } from "../support/fake-upstream.js";
import { insertApiKey, insertDashScopeImageModel } from "../support/inference.js";
import { createTestApp, setUpFirstUser } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };
const GENERATION_PATH = "/api/v1/services/aigc/multimodal-generation/generation";

describe("Watermark on DashScope media requests (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  it("sends the watermark on when the Model's Parameter Policy, saved from the dashboard, forces it", async () => {
    const cookie = await setUpFirstUser(app, OPERATOR);
    const { modelId } = await insertDashScopeImageModel(app, db, {
      modelName: "painter",
      baseUrl: `${upstream.origin}/api/v1`,
    });
    const { key } = await insertApiKey(app, db);
    await request(app.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .send({ parameterPolicy: { forced: { watermark: true } } })
      .expect(200);
    const answer = dashScopeImageFixture("upstream-response.json")
      .replace(/https:\/\/[^"]*first\.png[^"]*/, upstream.mediaUrl("/media/a.png"))
      .replace(/https:\/\/[^"]*second\.png[^"]*/, upstream.mediaUrl("/media/b.png"));
    upstream.replyTo(GENERATION_PATH, { kind: "json", status: 200, body: JSON.parse(answer) });
    for (const path of ["/media/a.png", "/media/b.png"]) {
      upstream.replyTo(path, {
        kind: "binary",
        status: 200,
        contentType: "image/png",
        body: new Uint8Array([1, 2, 3]),
      });
    }

    await request(app.getHttpServer())
      .post("/v1/images/generations")
      .set("Authorization", `Bearer ${key}`)
      .send({ model: "painter", prompt: "A red fox in snow" })
      .expect(200);

    const [sent] = upstream.requests.filter((received) => received.path === GENERATION_PATH);
    expect(sent.body).toMatchObject({ parameters: { watermark: true } });
  });
});
