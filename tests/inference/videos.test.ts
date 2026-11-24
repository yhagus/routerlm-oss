import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import {
  dashScopeVideoFixture,
  type FakeReply,
  FakeUpstream,
} from "@tests/support/fake-upstream.js";
import {
  addDashScopeVideoRoute,
  addProviderAccount,
  insertApiKey,
  insertDashScopeVideoModel,
  UPSTREAM_KEY,
  UPSTREAM_MODEL_ID,
} from "@tests/support/inference.js";
import { createTestApp } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const BACKUP_KEY = "sk-backup-secret-9876543210";
const VIDEO = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2, 3]);
const SYNTHESIS_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const TASK_ID = "0385dc79-5ff8-4d82-bcb6-6f2a8e5c1d21";
const TASK_PATH = `/api/v1/tasks/${TASK_ID}`;
const FRAME_URL = "https://images.example.com/first-frame.png";
const LAST_FRAME_URL = "https://images.example.com/last-frame.png";
const VIDEO_REQUEST = {
  model: "director",
  prompt: "A red fox runs through snow",
  seconds: "5",
  size: "1280x720",
};

describe("Video Jobs on /v1/videos (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let modelId: string;
  let providerId: string;
  let providerAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    ({ modelId, providerId, providerAccountId } = await insertDashScopeVideoModel(app, db, {
      modelName: "director",
      baseUrl: `${upstream.origin}/api/v1`,
      minDurationSeconds: 3,
      maxDurationSeconds: 15,
    }));
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function submit(body: object = VIDEO_REQUEST) {
    return request(app.getHttpServer())
      .post("/v1/videos")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(body);
  }

  function accepted(): FakeReply {
    return {
      kind: "json",
      status: 200,
      body: JSON.parse(dashScopeVideoFixture("upstream-create-response.json")),
    };
  }

  function synthesisRequests() {
    return upstream.requests.filter((received) => received.path === SYNTHESIS_PATH);
  }

  function poll(videoId: string, key = apiKey) {
    return request(app.getHttpServer())
      .get(`/v1/videos/${videoId}`)
      .set("Authorization", `Bearer ${key}`);
  }

  function download(videoId: string) {
    return request(app.getHttpServer())
      .get(`/v1/videos/${videoId}/content`)
      .set("Authorization", `Bearer ${apiKey}`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });
  }

  async function submitted(): Promise<string> {
    upstream.replyTo(SYNTHESIS_PATH, accepted());
    const response = await submit().expect(200);
    return response.body.id;
  }

  function taskIn(status: string): FakeReply {
    return {
      kind: "json",
      status: 200,
      body: { request_id: "r-1", output: { task_id: TASK_ID, task_status: status } },
    };
  }

  function taskSucceeded(path: string): FakeReply {
    const body = dashScopeVideoFixture("upstream-task-succeeded.json").replace(
      /https:\/\/[^"]*result\.mp4[^"]*/,
      upstream.mediaUrl(path),
    );
    return { kind: "json", status: 200, body: JSON.parse(body) };
  }

  it("submits a text-to-video task asynchronously in DashScope's shape and answers with a queued video", async () => {
    upstream.replyTo(SYNTHESIS_PATH, accepted());

    const response = await submit().expect(200);

    expect(response.body).toEqual({
      id: expect.stringMatching(/^video_/),
      object: "video",
      status: "queued",
      model: "director",
      seconds: "5",
      size: "1280x720",
      created_at: expect.any(Number),
    });
    expect(response.body.id).not.toContain(TASK_ID);
    const [sent] = synthesisRequests();
    expect(sent.headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(sent.headers["x-dashscope-async"]).toBe("enable");
    expect(sent.body).toEqual({
      model: UPSTREAM_MODEL_ID,
      input: { prompt: "A red fox runs through snow" },
      parameters: { resolution: "720P", ratio: "16:9", duration: 5, watermark: false },
    });
  });

  it("takes `resolution` and `aspect_ratio` in place of `size`, and integer seconds", async () => {
    upstream.replyTo(SYNTHESIS_PATH, accepted());

    await submit({
      model: "director",
      prompt: "A red fox",
      seconds: 8,
      resolution: "1080p",
      aspect_ratio: "9:16",
    }).expect(200);

    expect(synthesisRequests()[0].body).toMatchObject({
      parameters: { resolution: "1080P", ratio: "9:16", duration: 8 },
    });
  });

  it("refuses a size with no exact aspect ratio DashScope takes, naming it", async () => {
    const response = await submit({ ...VIDEO_REQUEST, size: "1792x1024" }).expect(400);

    expect(response.body.error.message).toContain("1792x1024");
    expect(upstream.requests).toHaveLength(0);
  });

  it.each([
    ["outside every Route's range", "20"],
    ["left to the Provider", "-1"],
  ])("refuses seconds %s", async (_case, seconds) => {
    await submit({ ...VIDEO_REQUEST, seconds }).expect(400);

    expect(upstream.requests).toHaveLength(0);
  });

  it("refuses a text-only request to a Model whose Routes lack the text-to-video Capability", async () => {
    await insertDashScopeVideoModel(app, db, {
      modelName: "animator",
      baseUrl: `${upstream.origin}/api/v1`,
      capabilities: ["first-frame"],
    });

    const response = await submit({ ...VIDEO_REQUEST, model: "animator" }).expect(400);

    expect(response.body.error.message).toContain("text-to-video");
  });

  function insertAnimator(options: { maxInputImages?: number } = {}) {
    return insertDashScopeVideoModel(app, db, {
      modelName: "animator",
      baseUrl: `${upstream.origin}/api/v1`,
      capabilities: ["first-frame", "last-frame", "reference-images"],
      ...options,
    });
  }

  it("sends an `input_reference` as the first frame, without the ratio", async () => {
    await insertAnimator();
    upstream.replyTo(SYNTHESIS_PATH, accepted());

    await submit({
      ...VIDEO_REQUEST,
      model: "animator",
      input_reference: { image_url: FRAME_URL },
    }).expect(200);

    expect(synthesisRequests()[0].body).toEqual({
      model: UPSTREAM_MODEL_ID,
      input: {
        prompt: "A red fox runs through snow",
        media: [{ type: "first_frame", url: FRAME_URL }],
      },
      parameters: { resolution: "720P", duration: 5, watermark: false },
    });
  });

  it("takes an uploaded `input_reference` file in a multipart form as the first frame", async () => {
    await insertAnimator();
    upstream.replyTo(SYNTHESIS_PATH, accepted());
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    await request(app.getHttpServer())
      .post("/v1/videos")
      .set("Authorization", `Bearer ${apiKey}`)
      .field("model", "animator")
      .field("prompt", "A red fox runs through snow")
      .field("seconds", "5")
      .field("size", "1280x720")
      .field("seed", "42")
      .attach("input_reference", png, { filename: "fox.png", contentType: "image/png" })
      .expect(200);

    expect(synthesisRequests()[0].body).toMatchObject({
      input: { media: [{ type: "first_frame", url: "data:image/png;base64,iVBORw==" }] },
      parameters: { duration: 5, seed: 42 },
    });
  });

  it("sends OpenRouter's `frame_images` as a first and a last frame", async () => {
    await insertAnimator();
    upstream.replyTo(SYNTHESIS_PATH, accepted());

    await submit({
      ...VIDEO_REQUEST,
      model: "animator",
      frame_images: [
        { type: "image_url", image_url: { url: LAST_FRAME_URL }, frame_type: "last_frame" },
        { type: "image_url", image_url: { url: FRAME_URL }, frame_type: "first_frame" },
      ],
    }).expect(200);

    expect(synthesisRequests()[0].body).toMatchObject({
      input: {
        media: [
          { type: "first_frame", url: FRAME_URL },
          { type: "last_frame", url: LAST_FRAME_URL },
        ],
      },
    });
  });

  it("skips a Route that takes fewer reference images than were sent", async () => {
    ({ modelId } = await insertAnimator({ maxInputImages: 1 }));
    await addDashScopeVideoRoute(app, db, modelId, {
      baseUrl: `${upstream.origin}/roomy/api/v1`,
      providerSlug: "roomy",
      priority: 1,
      capabilities: ["reference-images"],
      maxInputImages: 9,
    });
    upstream.replyTo(`/roomy${SYNTHESIS_PATH}`, accepted());

    await submit({
      ...VIDEO_REQUEST,
      model: "animator",
      input_references: [{ image_url: FRAME_URL }, { image_url: LAST_FRAME_URL }],
    }).expect(200);

    expect(upstream.requests.map((sent) => sent.path)).toEqual([`/roomy${SYNTHESIS_PATH}`]);
    expect(upstream.lastRequest.body).toMatchObject({
      input: {
        media: [
          { type: "reference_image", url: FRAME_URL },
          { type: "reference_image", url: LAST_FRAME_URL },
        ],
      },
      parameters: { ratio: "16:9" },
    });
  });

  it("refuses a first frame to a Model whose Routes lack the first-frame Capability, naming it", async () => {
    const response = await submit({
      ...VIDEO_REQUEST,
      input_reference: { image_url: FRAME_URL },
    }).expect(400);

    expect(response.body.error.message).toContain("first-frame");
    expect(upstream.requests).toHaveLength(0);
  });

  it("falls back to the next Provider Account when the submit fails", async () => {
    await addProviderAccount(app, db, providerId, { key: BACKUP_KEY, priority: 1 });
    upstream.replyTo(SYNTHESIS_PATH, { kind: "json", status: 503, body: { code: "Overloaded" } });
    upstream.replyTo(SYNTHESIS_PATH, accepted());

    await submit().expect(200);

    expect(synthesisRequests().map((sent) => sent.headers.authorization)).toEqual([
      `Bearer ${UPSTREAM_KEY}`,
      `Bearer ${BACKUP_KEY}`,
    ]);
  });

  it.each([
    ["PENDING", "queued"],
    ["RUNNING", "in_progress"],
    ["FAILED", "failed"],
    ["CANCELED", "failed"],
    ["UNKNOWN", "expired"],
  ])("reports a %s task as %s", async (taskStatus, status) => {
    const videoId = await submitted();
    upstream.replyTo(TASK_PATH, taskIn(taskStatus));

    const response = await poll(videoId).expect(200);

    expect(response.body).toMatchObject({
      id: videoId,
      object: "video",
      status,
      model: "director",
    });
  });

  it("polls the task with the submitting account's key and reports a finished one as completed", async () => {
    const videoId = await submitted();
    upstream.replyTo(TASK_PATH, taskSucceeded("/media/video.mp4"));

    const response = await poll(videoId).expect(200);

    expect(response.body).toEqual({
      id: videoId,
      object: "video",
      status: "completed",
      model: "director",
      seconds: "5",
      size: "1280x720",
      created_at: expect.any(Number),
      completed_at: 1_795_069_419,
    });
    const sent = upstream.lastRequest;
    expect(sent.method).toBe("GET");
    expect(sent.headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(JSON.stringify(response.body)).not.toContain("mp4");
  });

  it("streams a completed job's MP4 from the task's video URL", async () => {
    const videoId = await submitted();
    upstream.replyTo(TASK_PATH, taskSucceeded("/media/video.mp4"));
    upstream.replyTo("/media/video.mp4", {
      kind: "binary",
      status: 200,
      contentType: "application/octet-stream",
      body: VIDEO,
    });

    const response = await download(videoId).expect(200);

    expect(response.headers["content-type"]).toBe("video/mp4");
    expect(new Uint8Array(response.body)).toEqual(VIDEO);
  });

  it("answers 502 in the gateway's words when the video host can't be reached", async () => {
    const videoId = await submitted();
    upstream.replyTo(TASK_PATH, taskSucceeded("/media/video.mp4"));
    upstream.replyTo("/media/video.mp4", { kind: "reset" });

    const response = await download(videoId).expect(502);

    const body = response.body.toString();
    expect(body).toContain("upstream_error");
    expect(body).not.toContain("127.0.0.1");
  });

  it("refuses the content of a job that isn't completed with a 409", async () => {
    const videoId = await submitted();
    upstream.replyTo(TASK_PATH, taskIn("RUNNING"));

    const response = await download(videoId).expect(409);

    expect(response.body.toString()).toContain("video_not_ready");
  });

  it("answers 404 for the content of an expired job", async () => {
    const videoId = await submitted();
    upstream.replyTo(TASK_PATH, taskIn("UNKNOWN"));

    await download(videoId).expect(404);
  });

  it("answers 404 for an id that was tampered with or not issued by the gateway, without calling upstream", async () => {
    const videoId = await submitted();
    const tampered = `${videoId.slice(0, -2)}${videoId.endsWith("AA") ? "BB" : "AA"}`;

    await poll(tampered).expect(404);
    await poll("video_68d7512d07848190b3e45da0ecbebcde").expect(404);
    expect(upstream.requests.filter((sent) => sent.method === "GET")).toHaveLength(0);
  });

  it("answers 404 for an id issued to another API Key", async () => {
    const videoId = await submitted();
    const { key: otherKey } = await insertApiKey(app, db);

    const response = await poll(videoId, otherKey).expect(404);

    expect(response.body.error.code).toBe("video_not_found");
  });

  it("answers 404 once the job's Provider Account is disabled", async () => {
    const videoId = await submitted();
    await db
      .update(providerAccounts)
      .set({ isEnabled: false })
      .where(eq(providerAccounts.id, providerAccountId));
    await app.get(SnapshotService).changed();

    await poll(videoId).expect(404);
  });

  it("makes one poll call without Fallback, and a failed poll starts no Cooldown", async () => {
    await addProviderAccount(app, db, providerId, { key: BACKUP_KEY, priority: 1 });
    await addDashScopeVideoRoute(app, db, modelId, {
      baseUrl: `${upstream.origin}/api/v1`,
      providerSlug: "acme-backup",
      priority: 1,
    });
    const videoId = await submitted();
    upstream.replyTo(TASK_PATH, { kind: "json", status: 503, body: { code: "Overloaded" } });

    await poll(videoId).expect(502);
    upstream.replyTo(SYNTHESIS_PATH, accepted());
    await submit().expect(200);

    const polls = upstream.requests.filter((sent) => sent.path === TASK_PATH);
    expect(polls).toHaveLength(1);
    expect(synthesisRequests().map((sent) => sent.headers.authorization)).toEqual([
      `Bearer ${UPSTREAM_KEY}`,
      `Bearer ${UPSTREAM_KEY}`,
    ]);
  });
});
