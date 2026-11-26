import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { upstreamModels } from '@/db/schemas';
import { dashScopeSpeechFixture, FakeUpstream } from '@tests/support/fake-upstream';
import { insertDashScopeSpeechModel, UPSTREAM_MODEL_ID } from '@tests/support/inference';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const ADA = { email: 'ada@example.com', password: "ada's password" };
const SYNTHESIZER_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer';
const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 9, 8, 7]);
const SPEECH_REQUEST = { input: 'Hello from the gateway', voice: 'Cherry' };

describe('Playground speech (e2e)', () => {
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
    ({ routeId } = await insertDashScopeSpeechModel(app, db, {
      modelName: 'narrator',
      baseUrl: `${upstream.origin}/api/v1`,
      pricePerMillionCharacters: 20,
    }));
    [{ id: upstreamModelRowId }] = await db.select({ id: upstreamModels.id }).from(upstreamModels);
    const answer = dashScopeSpeechFixture('upstream-response.json').replace(
      /https:\/\/[^"]*speech\.mp3[^"]*/,
      upstream.mediaUrl('/media/speech.mp3'),
    );
    upstream.replyTo(SYNTHESIZER_PATH, { kind: 'json', status: 200, body: JSON.parse(answer) });
    upstream.replyTo('/media/speech.mp3', {
      kind: 'binary',
      status: 200,
      contentType: 'audio/mpeg',
      body: AUDIO,
    });
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  it('synthesizes speech from a Model, with the audio to play and a summary of characters and Cost', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/playground/audio/speech')
      .set('Cookie', adaCookie)
      .send({ ...SPEECH_REQUEST, model: 'narrator' })
      .expect(200);

    expect(response.body.audio).toEqual({
      contentType: 'audio/mpeg',
      base64: Buffer.from(AUDIO).toString('base64'),
    });
    expect(response.body.summary).toMatchObject({
      units: { characters: 22 },
      cost: 0.00044,
      route: { id: routeId },
      upstreamModel: { id: upstreamModelRowId, upstreamModelId: UPSTREAM_MODEL_ID },
    });
  });

  it('synthesizes speech from an Upstream Model directly, without a Route', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelRowId}/audio/speech`)
      .set('Cookie', adaCookie)
      .send({ ...SPEECH_REQUEST, model: UPSTREAM_MODEL_ID })
      .expect(200);

    expect(response.body.audio.base64).toBe(Buffer.from(AUDIO).toString('base64'));
    expect(response.body.summary).toMatchObject({
      route: null,
      upstreamModel: { id: upstreamModelRowId },
    });
  });

  it('needs a signed-in User', async () => {
    await request(app.getHttpServer())
      .post('/api/playground/audio/speech')
      .send({ ...SPEECH_REQUEST, model: 'narrator' })
      .expect(401);
  });
});
