import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts } from '@/db/schemas';
import { dashScopeImageFixture, type FakeReply, FakeUpstream } from '@tests/support/fake-upstream';
import {
  addDashScopeImageRoute,
  addProviderAccount,
  insertApiKey,
  insertDashScopeImageModel,
  insertOpenAiChatModel,
  UPSTREAM_KEY,
  UPSTREAM_MODEL_ID,
} from '@tests/support/inference';
import { allowPrivateUpstreams } from '@tests/support/private-upstreams';
import { createTestApp } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const BACKUP_KEY = 'sk-backup-secret-9876543210';
const GENERATION_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const IMAGE_REQUEST = { model: 'painter', prompt: 'A red fox in snow', n: 2, size: '1024x1024' };
const FIRST_IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const SECOND_IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);

describe('Image generation on /v1/images/generations (e2e)', () => {
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
    await deleteAllUpstreamData(app);
    ({ modelId, providerId, providerAccountId } = await insertDashScopeImageModel(app, db, {
      modelName: 'painter',
      baseUrl: `${upstream.origin}/api/v1`,
      sizes: ['1024*1024', '1536*1024'],
    }));
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterEach(async () => {
    await allowPrivateUpstreams(app, true);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function generate(body: object = IMAGE_REQUEST) {
    return request(app.getHttpServer())
      .post('/v1/images/generations')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(body);
  }

  function generated(...paths: [string, string]): Extract<FakeReply, { kind: 'json' }> {
    const [first, second] = paths.map((path) => upstream.mediaUrl(path));
    const body = dashScopeImageFixture('upstream-response.json')
      .replace(/https:\/\/[^"]*first\.png[^"]*/, first)
      .replace(/https:\/\/[^"]*second\.png[^"]*/, second);
    return { kind: 'json', status: 200, body: JSON.parse(body) };
  }

  function serveImages(...paths: [string, string]): void {
    upstream.replyTo(paths[0], {
      kind: 'binary',
      status: 200,
      contentType: 'image/png',
      body: FIRST_IMAGE,
    });
    upstream.replyTo(paths[1], {
      kind: 'binary',
      status: 200,
      contentType: 'image/png',
      body: SECOND_IMAGE,
    });
  }

  function generationRequests() {
    return upstream.requests.filter((received) => received.path === GENERATION_PATH);
  }

  it("answers with the generated images as b64_json, sent upstream in DashScope's shape", async () => {
    upstream.replyTo(GENERATION_PATH, generated('/media/a.png', '/media/b.png'));
    serveImages('/media/a.png', '/media/b.png');

    const response = await generate().expect(200);

    expect(response.body).toEqual({
      created: expect.any(Number),
      data: [
        { b64_json: Buffer.from(FIRST_IMAGE).toString('base64') },
        { b64_json: Buffer.from(SECOND_IMAGE).toString('base64') },
      ],
    });
    const [sent] = generationRequests();
    expect(sent.method).toBe('POST');
    expect(sent.headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(sent.body).toEqual({
      model: UPSTREAM_MODEL_ID,
      input: { messages: [{ role: 'user', content: [{ text: 'A red fox in snow' }] }] },
      parameters: { size: '1024*1024', n: 2, watermark: false },
    });
  });

  it('passes negative_prompt and seed through as DashScope parameters', async () => {
    upstream.replyTo(GENERATION_PATH, generated('/media/a.png', '/media/b.png'));
    serveImages('/media/a.png', '/media/b.png');

    await generate({ ...IMAGE_REQUEST, negative_prompt: 'blurry', seed: 42 }).expect(200);

    expect(generationRequests()[0].body).toMatchObject({
      parameters: { negative_prompt: 'blurry', seed: 42 },
    });
  });

  it("refuses a size the Upstream Model can't produce, naming it, without calling upstream", async () => {
    const response = await generate({ ...IMAGE_REQUEST, size: '512x512' }).expect(400);

    expect(response.body.error.message).toContain('512x512');
    expect(upstream.requests).toHaveLength(0);
  });

  it("skips a Route that can't produce the size for one that can", async () => {
    await addDashScopeImageRoute(app, db, modelId, {
      baseUrl: `${upstream.origin}/api/v1`,
      providerSlug: 'acme-large-sizes',
      priority: 1,
      sizes: ['2048*2048'],
    });
    upstream.replyTo(GENERATION_PATH, generated('/media/a.png', '/media/b.png'));
    serveImages('/media/a.png', '/media/b.png');

    await generate({ ...IMAGE_REQUEST, size: '2048x2048' }).expect(200);

    expect(generationRequests()).toHaveLength(1);
    expect(generationRequests()[0].body).toMatchObject({ parameters: { size: '2048*2048' } });
  });

  it.each([
    ['response_format', { response_format: 'url' }],
    ['stream', { stream: true }],
    ['partial_images', { partial_images: 2 }],
    ['mask', { mask: 'data:image/png;base64,AAAA' }],
  ])('refuses %s, naming it', async (feature, extra) => {
    const response = await generate({ ...IMAGE_REQUEST, ...extra }).expect(400);

    expect(response.body.error.code).toBe('invalid_request');
    expect(response.body.error.message).toContain(feature);
    expect(upstream.requests).toHaveLength(0);
  });

  it('refuses a chat Model, naming both Kinds', async () => {
    await insertOpenAiChatModel(app, db, { modelName: 'smart', baseUrl: upstream.baseUrl });

    const response = await generate({ ...IMAGE_REQUEST, model: 'smart' }).expect(400);

    expect(response.body.error.message).toMatch(/Kind chat.*Kind image/);
  });

  it('falls back to the next Provider Account when the upstream call fails', async () => {
    await addProviderAccount(app, db, providerId, { key: BACKUP_KEY, priority: 1 });
    upstream.replyTo(GENERATION_PATH, { kind: 'json', status: 503, body: { code: 'Overloaded' } });
    upstream.replyTo(GENERATION_PATH, generated('/media/a.png', '/media/b.png'));
    serveImages('/media/a.png', '/media/b.png');

    await generate().expect(200);

    expect(generationRequests().map((sent) => sent.headers.authorization)).toEqual([
      `Bearer ${UPSTREAM_KEY}`,
      `Bearer ${BACKUP_KEY}`,
    ]);
  });

  it("falls back to the next Route when a generated image can't be fetched", async () => {
    await addDashScopeImageRoute(app, db, modelId, {
      baseUrl: `${upstream.origin}/api/v1`,
      providerSlug: 'acme-backup',
      priority: 1,
    });
    upstream.replyTo(GENERATION_PATH, generated('/media/gone.png', '/media/gone-too.png'));
    upstream.replyTo('/media/gone.png', {
      kind: 'binary',
      status: 404,
      contentType: 'text/plain',
      body: new Uint8Array(),
    });
    upstream.replyTo(GENERATION_PATH, generated('/media/a.png', '/media/b.png'));
    serveImages('/media/a.png', '/media/b.png');

    const response = await generate().expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(generationRequests()).toHaveLength(2);
  });

  it('moves on from an account DashScope refuses as in arrears, rather than failing the request', async () => {
    await addProviderAccount(app, db, providerId, { key: BACKUP_KEY, priority: 1 });
    upstream.replyTo(GENERATION_PATH, {
      kind: 'json',
      status: 400,
      body: {
        code: 'Arrearage',
        message: 'Access denied, please make sure your account is in good standing.',
      },
    });
    upstream.replyTo(GENERATION_PATH, generated('/media/a.png', '/media/b.png'));
    serveImages('/media/a.png', '/media/b.png');

    await generate().expect(200);

    expect(generationRequests()).toHaveLength(2);
  });

  it('disables the Provider Account DashScope answers InvalidApiKey to', async () => {
    upstream.replyTo(GENERATION_PATH, {
      kind: 'json',
      status: 401,
      body: { code: 'InvalidApiKey', message: 'Invalid API-key provided.' },
    });

    await generate().expect(502);

    await expect
      .poll(async () => {
        const [account] = await db
          .select({ isEnabled: providerAccounts.isEnabled })
          .from(providerAccounts)
          .where(eq(providerAccounts.id, providerAccountId));
        return account.isEnabled;
      })
      .toBe(false);
  });

  it("does not retry a prompt DashScope's content inspection refused on another account", async () => {
    await addProviderAccount(app, db, providerId, { key: BACKUP_KEY, priority: 1 });
    upstream.replyTo(GENERATION_PATH, {
      kind: 'json',
      status: 400,
      body: {
        code: 'DataInspectionFailed',
        message: 'Input data may contain inappropriate content.',
      },
    });

    const response = await generate().expect(400);

    expect(response.body.error.code).toBe('invalid_request');
    expect(generationRequests()).toHaveLength(1);
  });

  it("refuses a generated image on a private address when the Setting doesn't allow them", async () => {
    upstream.replyTo(GENERATION_PATH, {
      ...generated('/media/a.png', '/media/b.png'),
      onReceived: () => allowPrivateUpstreams(app, false),
    });
    serveImages('/media/a.png', '/media/b.png');

    await generate().expect(502);

    expect(upstream.requests.map((received) => received.path)).toEqual([GENERATION_PATH]);
  });
});
