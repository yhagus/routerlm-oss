import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { MAX_UPLOAD_BYTES } from "@/inference/models/uploaded-file.js";
import { dashScopeTranscriptionFixture, FakeUpstream } from "../support/fake-upstream.js";
import {
  addProviderAccount,
  insertApiKey,
  insertDashScopeSpeechModel,
  insertDashScopeTranscriptionModel,
  UPSTREAM_KEY,
  UPSTREAM_MODEL_ID,
} from "../support/inference.js";
import { createTestApp } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

const GENERATION_PATH = "/api/v1/services/aigc/multimodal-generation/generation";
const SPEECH_MP3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 1, 2, 3]);
const BACKUP_KEY = "sk-backup-secret-9876543210";
const SPEECH_DATA_URI = `data:audio/mpeg;base64,${SPEECH_MP3.toString("base64")}`;

describe("Transcription on /v1/audio/transcriptions (e2e)", () => {
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
    ({ providerId } = await insertDashScopeTranscriptionModel(app, db, {
      modelName: "scribe",
      baseUrl: `${upstream.origin}/api/v1`,
    }));
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  /** A multipart transcription request uploading `file`, with `fields` as form fields. */
  function transcribe(
    fields: Record<string, string> = {},
    file: { bytes: Buffer; filename: string; contentType: string } = {
      bytes: SPEECH_MP3,
      filename: "speech.mp3",
      contentType: "audio/mpeg",
    },
  ) {
    const form = request(app.getHttpServer())
      .post("/v1/audio/transcriptions")
      .set("Authorization", `Bearer ${apiKey}`);
    for (const [name, value] of Object.entries({ model: "scribe", ...fields })) {
      form.field(name, value);
    }
    return form.attach("file", file.bytes, {
      filename: file.filename,
      contentType: file.contentType,
    });
  }

  function answerWithTranscript(): void {
    upstream.replyTo(GENERATION_PATH, {
      kind: "json",
      status: 200,
      body: JSON.parse(dashScopeTranscriptionFixture("upstream-response.json")),
    });
  }

  function generationRequests() {
    return upstream.requests.filter((received) => received.path === GENERATION_PATH);
  }

  it("answers with the transcript and the audio seconds, sent upstream in DashScope's shape", async () => {
    answerWithTranscript();

    const response = await transcribe({ language: "en" }).expect(200);

    expect(response.body).toEqual({
      text: "Hello from the gateway",
      usage: { type: "duration", seconds: 4 },
    });
    const [sent] = generationRequests();
    expect(sent.headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(sent.body).toEqual({
      model: UPSTREAM_MODEL_ID,
      input: {
        messages: [
          {
            role: "user",
            content: [{ type: "input_audio", input_audio: { data: SPEECH_DATA_URI } }],
          },
        ],
      },
      parameters: { format: "mp3", language_hints: ["en"] },
    });
  });

  it("answers with the transcript alone as plain text when asked for text", async () => {
    answerWithTranscript();

    const response = await transcribe({ response_format: "text" }).expect(200);

    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.text).toBe("Hello from the gateway");
  });

  it("tells DashScope the format from the file name when the upload's type is generic", async () => {
    answerWithTranscript();

    await transcribe(
      {},
      { bytes: SPEECH_MP3, filename: "meeting.WAV", contentType: "application/octet-stream" },
    ).expect(200);

    expect(generationRequests()[0].body).toMatchObject({ parameters: { format: "wav" } });
  });

  it("refuses an upload over 25 MB with a 413, before calling upstream", async () => {
    const response = await transcribe(
      {},
      {
        bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1),
        filename: "long.mp3",
        contentType: "audio/mpeg",
      },
    ).expect(413);

    expect(response.body.error.code).toBe("request_too_large");
    expect(upstream.requests).toHaveLength(0);
  });

  it("refuses a multipart form that breaks off, saying so", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/audio/transcriptions")
      .set("Authorization", `Bearer ${apiKey}`)
      .set("Content-Type", "multipart/form-data; boundary=cut")
      .send('--cut\r\nContent-Disposition: form-data; name="model"\r\n\r\nscribe')
      .expect(400);

    expect(response.body.error.message).toBe(
      "The request body could not be read as a multipart form",
    );
  });

  it("refuses a response_format other than json or text, naming it", async () => {
    const response = await transcribe({ response_format: "srt" }).expect(400);

    expect(response.body.error.message).toContain('"srt"');
    expect(generationRequests()).toHaveLength(0);
  });

  it("refuses a streamed transcript, naming stream", async () => {
    const response = await transcribe({ stream: "true" }).expect(400);

    expect(response.body.error.message).toContain("stream");
  });

  it("refuses an uploaded file that is not audio, naming its type", async () => {
    const response = await transcribe(
      {},
      { bytes: Buffer.from("hello"), filename: "notes.txt", contentType: "text/plain" },
    ).expect(400);

    expect(response.body.error.message).toContain('"text/plain"');
  });

  it("falls back to the next Provider Account when the upstream call fails", async () => {
    await addProviderAccount(app, db, providerId, { key: BACKUP_KEY, priority: 1 });
    upstream.replyTo(GENERATION_PATH, { kind: "json", status: 503, body: { code: "Overloaded" } });
    answerWithTranscript();

    const response = await transcribe().expect(200);

    expect(response.body.text).toBe("Hello from the gateway");
    expect(generationRequests().map((sent) => sent.headers.authorization)).toEqual([
      `Bearer ${UPSTREAM_KEY}`,
      `Bearer ${BACKUP_KEY}`,
    ]);
  });

  it("refuses a speech Model, naming both Kinds", async () => {
    await insertDashScopeSpeechModel(app, db, {
      modelName: "narrator",
      baseUrl: `${upstream.origin}/api/v1`,
    });

    const response = await transcribe({ model: "narrator" }).expect(400);

    expect(response.body.error.message).toMatch(/Kind speech.*Kind transcription/);
  });
});
