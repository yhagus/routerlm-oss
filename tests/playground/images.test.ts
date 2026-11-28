import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { upstreamModels } from '@/db/schemas';
import { dashScopeImageFixture, FakeUpstream } from '@tests/support/fake-upstream';
import { insertDashScopeImageModel, UPSTREAM_MODEL_ID } from '@tests/support/inference';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const ADA = { email: 'ada@example.com', password: "ada's password" };
const GENERATION_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7]);

describe('Playground image generation (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let adaCookie: string;
  let routeId: string;
  let providerAccountId: string;
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
    ({ routeId, providerAccountId } = await insertDashScopeImageModel(app, db, {
      modelName: 'painter',
      baseUrl: `${upstream.origin}/api/v1`,
      pricePerImageBySize: { '1K': 0.04 },
    }));
    [{ id: upstreamModelRowId }] = await db.select({ id: upstreamModels.id }).from(upstreamModels);
    const answer = dashScopeImageFixture('upstream-response.json')
      .replace(/https:\/\/[^"]*first\.png[^"]*/, upstream.mediaUrl('/media/a.png'))
      .replace(/https:\/\/[^"]*second\.png[^"]*/, upstream.mediaUrl('/media/b.png'));
    upstream.replyTo(GENERATION_PATH, { kind: 'json', status: 200, body: JSON.parse(answer) });
    for (const path of ['/media/a.png', '/media/b.png']) {
      upstream.replyTo(path, {
        kind: 'binary',
        status: 200,
        contentType: 'image/png',
        body: IMAGE,
      });
    }
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  it('generates images from a Model, with a summary of the images, Cost and what served them', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/playground/images/generations')
      .set('Cookie', adaCookie)
      .send({ model: 'painter', prompt: 'A red fox in snow', n: 2 })
      .expect(200);

    expect(response.body.response.data).toEqual([
      { b64_json: Buffer.from(IMAGE).toString('base64') },
      { b64_json: Buffer.from(IMAGE).toString('base64') },
    ]);
    expect(response.body.summary).toMatchObject({
      units: { imagesOut: 2, tier: '1K' },
      cost: 0.08,
      route: { id: routeId },
      upstreamModel: { id: upstreamModelRowId, upstreamModelId: UPSTREAM_MODEL_ID },
      providerAccount: { id: providerAccountId },
    });
  });

  it('generates images from an Upstream Model directly, without a Route', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelRowId}/images/generations`)
      .set('Cookie', adaCookie)
      .send({ model: UPSTREAM_MODEL_ID, prompt: 'A red fox in snow', n: 2 })
      .expect(200);

    expect(response.body.response.data).toHaveLength(2);
    expect(response.body.summary).toMatchObject({
      route: null,
      upstreamModel: { id: upstreamModelRowId },
    });
  });

  it('needs a signed-in User', async () => {
    await request(app.getHttpServer())
      .post('/api/playground/images/generations')
      .send({ model: 'painter', prompt: 'A red fox in snow' })
      .expect(401);
  });

  it('edits uploaded images with a Model, counting the input images in the summary', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/playground/images/edits')
      .set('Cookie', adaCookie)
      .field('model', 'painter')
      .field('prompt', 'Make the fox blue')
      .attach('image[]', Buffer.from(IMAGE), { filename: 'fox.png', contentType: 'image/png' })
      .expect(200);

    expect(response.body.response.data).toHaveLength(2);
    expect(response.body.summary).toMatchObject({
      units: { imagesOut: 2, imagesIn: 1 },
      route: { id: routeId },
    });
  });

  it('edits images with an Upstream Model directly, without a Route', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelRowId}/images/edits`)
      .set('Cookie', adaCookie)
      .send({
        model: UPSTREAM_MODEL_ID,
        prompt: 'Make the fox blue',
        images: [{ image_url: 'https://images.example.com/fox.png' }],
      })
      .expect(200);

    expect(response.body.summary).toMatchObject({
      units: { imagesIn: 1 },
      route: null,
      upstreamModel: { id: upstreamModelRowId },
    });
  });
});
