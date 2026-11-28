import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { upstreamModels } from '@/db/schemas';
import { dashScopeVideoFixture, FakeUpstream } from '@tests/support/fake-upstream';
import {
  insertApiKey,
  insertDashScopeVideoModel,
  UPSTREAM_MODEL_ID,
} from '@tests/support/inference';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const ADA = { email: 'ada@example.com', password: "ada's password" };
const SYNTHESIS_PATH = '/api/v1/services/aigc/video-generation/video-synthesis';
const TASK_PATH = '/api/v1/tasks/0385dc79-5ff8-4d82-bcb6-6f2a8e5c1d21';
const VIDEO = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 9]);
const VIDEO_REQUEST = { model: 'director', prompt: 'A red fox', seconds: '5', size: '1280x720' };

describe('Playground Video Jobs (e2e)', () => {
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
    await deleteAllUpstreamData(app);
    await deleteAllUsers(app);
    adaCookie = await setUpFirstUser(app, ADA);
    ({ routeId } = await insertDashScopeVideoModel(app, db, {
      modelName: 'director',
      baseUrl: `${upstream.origin}/api/v1`,
      pricePerSecondByResolution: { '720P': 0.1 },
    }));
    [{ id: upstreamModelRowId }] = await db.select({ id: upstreamModels.id }).from(upstreamModels);
    upstream.replyTo(SYNTHESIS_PATH, {
      kind: 'json',
      status: 200,
      body: JSON.parse(dashScopeVideoFixture('upstream-create-response.json')),
    });
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function queueFinishedTask(): void {
    const answer = dashScopeVideoFixture('upstream-task-succeeded.json').replace(
      /https:\/\/[^"]*result\.mp4[^"]*/,
      upstream.mediaUrl('/media/video.mp4'),
    );
    upstream.replyTo(TASK_PATH, { kind: 'json', status: 200, body: JSON.parse(answer) });
  }

  it('submits a Video Job from a Model, with a summary of its seconds, Cost and Route', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/playground/videos')
      .set('Cookie', adaCookie)
      .send(VIDEO_REQUEST)
      .expect(200);

    expect(response.body.response).toMatchObject({ object: 'video', status: 'queued' });
    expect(response.body.summary).toMatchObject({
      units: { outputSeconds: 5, tier: '720P' },
      cost: 0.5,
      route: { id: routeId },
    });
  });

  it('submits a Video Job to an Upstream Model directly, then follows it and plays its content', async () => {
    const submitted = await request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelRowId}/videos`)
      .set('Cookie', adaCookie)
      .send({ ...VIDEO_REQUEST, model: UPSTREAM_MODEL_ID })
      .expect(200);
    const videoId: string = submitted.body.response.id;

    queueFinishedTask();
    const polled = await request(app.getHttpServer())
      .get(`/api/playground/videos/${videoId}`)
      .set('Cookie', adaCookie)
      .expect(200);
    queueFinishedTask();
    upstream.replyTo('/media/video.mp4', {
      kind: 'binary',
      status: 200,
      contentType: 'video/mp4',
      body: VIDEO,
    });
    const content = await request(app.getHttpServer())
      .get(`/api/playground/videos/${videoId}/content`)
      .set('Cookie', adaCookie)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(polled.body).toMatchObject({ id: videoId, status: 'completed' });
    expect(content.headers['content-type']).toBe('video/mp4');
    expect(new Uint8Array(content.body)).toEqual(VIDEO);
  });

  it('answers 404 for a video id issued to an API Key rather than the User', async () => {
    const { key } = await insertApiKey(app, db);
    const submitted = await request(app.getHttpServer())
      .post('/v1/videos')
      .set('Authorization', `Bearer ${key}`)
      .send(VIDEO_REQUEST)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/playground/videos/${submitted.body.id}`)
      .set('Cookie', adaCookie)
      .expect(404);
  });
});
