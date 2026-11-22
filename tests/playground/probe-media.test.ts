import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { upstreamModels } from "@/db/schemas/index.js";
import {
  DASHSCOPE_GENERATION_PATH,
  dashScopeSpeechFixture,
  dashScopeTranscriptionFixture,
  FakeUpstream,
  replyWithTwoDashScopeImages,
} from "@tests/support/fake-upstream.js";
import {
  insertDashScopeImageModel,
  insertDashScopeSpeechModel,
  insertDashScopeTranscriptionModel,
} from "@tests/support/inference.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const SYNTHESIZER_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";

describe("Probe of a media Upstream Model (e2e)", () => {
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
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  async function probeTheUpstreamModel() {
    const [{ id }] = await db.select({ id: upstreamModels.id }).from(upstreamModels);
    return request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${id}/probe`)
      .set("Cookie", adaCookie)
      .expect(200);
  }

  it("generates one image at the Upstream Model's smallest size", async () => {
    await insertDashScopeImageModel(app, db, {
      modelName: "painter",
      baseUrl: `${upstream.origin}/api/v1`,
      sizes: ["1024*1024", "512*512", "768*1344"],
    });
    replyWithTwoDashScopeImages(upstream);

    const response = await probeTheUpstreamModel();

    expect(response.body.results).toEqual([expect.objectContaining({ ok: true })]);
    expect(upstream.requests[0].body).toMatchObject({ parameters: { size: "512*512", n: 1 } });
  });

  it("synthesizes a short text with a default voice", async () => {
    await insertDashScopeSpeechModel(app, db, {
      modelName: "narrator",
      baseUrl: `${upstream.origin}/api/v1`,
    });
    const answer = dashScopeSpeechFixture("upstream-response.json").replace(
      /https:\/\/[^"]*speech\.mp3[^"]*/,
      upstream.mediaUrl("/media/speech.mp3"),
    );
    upstream.replyTo(SYNTHESIZER_PATH, { kind: "json", status: 200, body: JSON.parse(answer) });
    upstream.replyTo("/media/speech.mp3", {
      kind: "binary",
      status: 200,
      contentType: "audio/mpeg",
      body: new Uint8Array([0x49, 0x44, 0x33]),
    });

    const response = await probeTheUpstreamModel();

    expect(response.body.results).toEqual([expect.objectContaining({ ok: true })]);
    expect(upstream.requests[0].body).toMatchObject({ input: { voice: "Cherry" } });
  });

  it("transcribes the bundled audio clip", async () => {
    await insertDashScopeTranscriptionModel(app, db, {
      modelName: "scribe",
      baseUrl: `${upstream.origin}/api/v1`,
    });
    upstream.replyTo(DASHSCOPE_GENERATION_PATH, {
      kind: "json",
      status: 200,
      body: JSON.parse(dashScopeTranscriptionFixture("upstream-response.json")),
    });

    const response = await probeTheUpstreamModel();

    expect(response.body.results).toEqual([expect.objectContaining({ ok: true })]);
    expect(JSON.stringify(upstream.requests[0].body)).toContain("data:audio/wav;base64,");
  });
});
