import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { routes } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { dashScopeSpeechFixture, FakeUpstream } from '@tests/support/fake-upstream';
import {
  addProviderAccount,
  insertApiKey,
  insertDashScopeImageModel,
  insertDashScopeSpeechModel,
  UPSTREAM_KEY,
  UPSTREAM_MODEL_ID,
} from '@tests/support/inference';
import { createTestApp } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const SYNTHESIZER_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer';
const AUDIO_PATH = '/media/speech.bin';
const SPEECH_REQUEST = {
  model: 'narrator',
  input: 'Hello from the gateway',
  voice: 'Cherry',
  response_format: 'wav',
};
const BACKUP_KEY = 'sk-backup-speech-key';
const AUDIO = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);

describe('Speech on /v1/audio/speech (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let routeId: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    ({ routeId, providerId } = await insertDashScopeSpeechModel(app, db, {
      modelName: 'narrator',
      baseUrl: `${upstream.origin}/api/v1`,
    }));
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function synthesize(body: object = SPEECH_REQUEST) {
    return request(app.getHttpServer())
      .post('/v1/audio/speech')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(body)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });
  }

  function answerWithAudio(): void {
    const answer = dashScopeSpeechFixture('upstream-response.json').replace(
      /https:\/\/[^"]*speech\.mp3[^"]*/,
      upstream.mediaUrl(AUDIO_PATH),
    );
    upstream.replyTo(SYNTHESIZER_PATH, { kind: 'json', status: 200, body: JSON.parse(answer) });
    upstream.replyTo(AUDIO_PATH, {
      kind: 'binary',
      status: 200,
      contentType: 'application/octet-stream',
      body: AUDIO,
    });
  }

  function synthesizerRequests() {
    return upstream.requests.filter((received) => received.path === SYNTHESIZER_PATH);
  }

  it("answers with the audio bytes in the asked format, sent upstream in DashScope's shape", async () => {
    answerWithAudio();

    const response = await synthesize().expect(200);

    expect(response.headers['content-type']).toBe('audio/wav');
    expect(new Uint8Array(response.body)).toEqual(AUDIO);
    const [sent] = synthesizerRequests();
    expect(sent.method).toBe('POST');
    expect(sent.headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(sent.body).toEqual({
      model: UPSTREAM_MODEL_ID,
      input: { text: 'Hello from the gateway', voice: 'Cherry', format: 'wav' },
    });
  });

  it("sends speed as DashScope's rate", async () => {
    answerWithAudio();

    await synthesize({ ...SPEECH_REQUEST, speed: 1.5 }).expect(200);

    expect(synthesizerRequests()[0].body).toMatchObject({ input: { rate: 1.5 } });
  });

  it('falls back to the next Provider Account when the upstream call fails', async () => {
    await addProviderAccount(app, db, providerId, { key: BACKUP_KEY, priority: 1 });
    upstream.replyTo(SYNTHESIZER_PATH, { kind: 'json', status: 503, body: { code: 'Overloaded' } });
    answerWithAudio();

    const response = await synthesize().expect(200);

    expect(new Uint8Array(response.body)).toEqual(AUDIO);
    expect(synthesizerRequests().map((sent) => sent.headers.authorization)).toEqual([
      `Bearer ${UPSTREAM_KEY}`,
      `Bearer ${BACKUP_KEY}`,
    ]);
  });

  it("refuses a response_format DashScope can't produce, naming it", async () => {
    const response = await synthesize({ ...SPEECH_REQUEST, response_format: 'flac' }).expect(400);

    expect(JSON.parse(response.body.toString()).error.message).toContain('"flac"');
    expect(synthesizerRequests()).toHaveLength(0);
  });

  it('refuses streamed speech, naming stream_format', async () => {
    const response = await synthesize({ ...SPEECH_REQUEST, stream_format: 'sse' }).expect(400);

    expect(JSON.parse(response.body.toString()).error.message).toContain('stream_format');
  });

  it('accepts instructions without sending them, as qwen-audio-3.0-tts-plus is not known to honour them', async () => {
    answerWithAudio();

    await synthesize({ ...SPEECH_REQUEST, instructions: 'Speak softly' }).expect(200);

    expect(JSON.stringify(synthesizerRequests()[0].body)).not.toContain('Speak softly');
  });

  it("sends the voice a Route's Parameter Policy forces instead of the client's", async () => {
    await db
      .update(routes)
      .set({ parameterPolicyOverride: { forced: { voice: 'Ethan' } } })
      .where(eq(routes.id, routeId));
    await app.get(SnapshotService).changed();
    answerWithAudio();

    await synthesize().expect(200);

    expect(synthesizerRequests()[0].body).toMatchObject({ input: { voice: 'Ethan' } });
  });

  it('refuses an image Model, naming both Kinds', async () => {
    await insertDashScopeImageModel(app, db, {
      modelName: 'painter',
      baseUrl: `${upstream.origin}/api/v1`,
    });

    const response = await synthesize({ ...SPEECH_REQUEST, model: 'painter' }).expect(400);

    expect(JSON.parse(response.body.toString()).error.message).toMatch(/Kind image.*Kind speech/);
  });
});
