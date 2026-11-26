import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations";
import { upstreamModels } from "@/db/schemas";
import { dashScopeTranscriptionFixture, FakeUpstream } from "@tests/support/fake-upstream";
import { insertDashScopeTranscriptionModel, UPSTREAM_MODEL_ID } from "@tests/support/inference";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app";
import { deleteAllUpstreamData } from "@tests/support/upstream";

const ADA = { email: "ada@example.com", password: "ada's password" };
const GENERATION_PATH = "/api/v1/services/aigc/multimodal-generation/generation";
const SPEECH_MP3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 1, 2, 3]);
const UPLOAD = { filename: "speech.mp3", contentType: "audio/mpeg" };

describe("Playground transcription (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let adaCookie: string;
  let routeId: string;
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
    ({ routeId } = await insertDashScopeTranscriptionModel(app, db, {
      modelName: "scribe",
      baseUrl: `${upstream.origin}/api/v1`,
      pricePerAudioSecond: 0.000035,
    }));
    [{ id: upstreamModelRowId }] = await db.select({ id: upstreamModels.id }).from(upstreamModels);
    upstream.replyTo(GENERATION_PATH, {
      kind: "json",
      status: 200,
      body: JSON.parse(dashScopeTranscriptionFixture("upstream-response.json")),
    });
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  it("transcribes an uploaded file with a Model, with the transcript and a summary of audio seconds and Cost", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/playground/audio/transcriptions")
      .set("Cookie", adaCookie)
      .field("model", "scribe")
      .attach("file", SPEECH_MP3, UPLOAD)
      .expect(200);

    expect(response.body.text).toBe("Hello from the gateway");
    expect(response.body.summary).toMatchObject({
      units: { audioSeconds: 4 },
      cost: 0.00014,
      route: { id: routeId },
      upstreamModel: { id: upstreamModelRowId, upstreamModelId: UPSTREAM_MODEL_ID },
    });
  });

  it("transcribes with an Upstream Model directly, without a Route", async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelRowId}/audio/transcriptions`)
      .set("Cookie", adaCookie)
      .field("model", UPSTREAM_MODEL_ID)
      .attach("file", SPEECH_MP3, UPLOAD)
      .expect(200);

    expect(response.body.text).toBe("Hello from the gateway");
    expect(response.body.summary).toMatchObject({
      route: null,
      upstreamModel: { id: upstreamModelRowId },
    });
  });

  it("needs a signed-in User", async () => {
    await request(app.getHttpServer())
      .post("/api/playground/audio/transcriptions")
      .field("model", "scribe")
      .attach("file", SPEECH_MP3, UPLOAD)
      .expect(401);
  });
});
