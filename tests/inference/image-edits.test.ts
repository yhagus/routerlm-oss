import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { dashScopeImageFixture, type FakeReply, FakeUpstream } from '@tests/support/fake-upstream';
import {
  addDashScopeImageRoute,
  insertApiKey,
  insertDashScopeImageModel,
} from '@tests/support/inference';
import { createTestApp } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const GENERATION_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const PROMPT = "Put the fox in the cat's place";
const FOX_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 7, 7, 7]);
const CAT_JPEG = Buffer.from([0xff, 0xd8, 0xff, 9, 9, 9]);
const FOX_DATA_URI = `data:image/png;base64,${FOX_PNG.toString('base64')}`;
const CAT_DATA_URI = `data:image/jpeg;base64,${CAT_JPEG.toString('base64')}`;
const FIRST_IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const SECOND_IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);

describe('Image edits on /v1/images/edits (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let modelId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    ({ modelId } = await insertDashScopeImageModel(app, db, {
      modelName: 'painter',
      baseUrl: `${upstream.origin}/api/v1`,
      maxInputImages: 2,
    }));
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function edit() {
    return request(app.getHttpServer())
      .post('/v1/images/edits')
      .set('Authorization', `Bearer ${apiKey}`);
  }

  function answerWithTwoImages(): void {
    const body = dashScopeImageFixture('upstream-response.json')
      .replace(/https:\/\/[^"]*first\.png[^"]*/, upstream.mediaUrl('/media/a.png'))
      .replace(/https:\/\/[^"]*second\.png[^"]*/, upstream.mediaUrl('/media/b.png'));
    const answer: FakeReply = { kind: 'json', status: 200, body: JSON.parse(body) };
    upstream.replyTo(GENERATION_PATH, answer);
    upstream.replyTo('/media/a.png', {
      kind: 'binary',
      status: 200,
      contentType: 'image/png',
      body: FIRST_IMAGE,
    });
    upstream.replyTo('/media/b.png', {
      kind: 'binary',
      status: 200,
      contentType: 'image/png',
      body: SECOND_IMAGE,
    });
  }

  function generationRequests() {
    return upstream.requests.filter((received) => received.path === GENERATION_PATH);
  }

  it('edits uploaded images, sending each upstream as a data URI', async () => {
    answerWithTwoImages();

    const response = await edit()
      .field('model', 'painter')
      .field('prompt', PROMPT)
      .field('n', '2')
      .attach('image[]', FOX_PNG, { filename: 'fox.png', contentType: 'image/png' })
      .attach('image[]', CAT_JPEG, { filename: 'cat.jpg', contentType: 'image/jpeg' })
      .expect(200);

    expect(response.body).toEqual({
      created: expect.any(Number),
      data: [
        { b64_json: Buffer.from(FIRST_IMAGE).toString('base64') },
        { b64_json: Buffer.from(SECOND_IMAGE).toString('base64') },
      ],
    });
    expect(generationRequests()[0].body).toMatchObject({
      input: {
        messages: [
          {
            role: 'user',
            content: [{ image: FOX_DATA_URI }, { image: CAT_DATA_URI }, { text: PROMPT }],
          },
        ],
      },
      parameters: { n: 2, watermark: false },
    });
  });

  it('edits images given as JSON image URLs or data URIs', async () => {
    answerWithTwoImages();

    await edit()
      .send({
        model: 'painter',
        prompt: PROMPT,
        images: [{ image_url: 'https://images.example.com/fox.png' }, { image_url: CAT_DATA_URI }],
      })
      .expect(200);

    expect(generationRequests()[0].body).toMatchObject({
      input: {
        messages: [
          {
            content: [
              { image: 'https://images.example.com/fox.png' },
              { image: CAT_DATA_URI },
              { text: PROMPT },
            ],
          },
        ],
      },
    });
  });

  it('skips a Route that takes fewer input images for one that takes them all', async () => {
    await addDashScopeImageRoute(app, db, modelId, {
      baseUrl: `${upstream.origin}/api/v1`,
      providerSlug: 'acme-many-inputs',
      priority: 1,
      maxInputImages: 9,
    });
    answerWithTwoImages();

    await edit()
      .send({
        model: 'painter',
        prompt: PROMPT,
        images: [
          { image_url: FOX_DATA_URI },
          { image_url: CAT_DATA_URI },
          { image_url: FOX_DATA_URI },
        ],
      })
      .expect(200);

    expect(generationRequests()).toHaveLength(1);
  });

  it('refuses more input images than any Route takes, naming the limit', async () => {
    const response = await edit()
      .send({
        model: 'painter',
        prompt: PROMPT,
        images: [
          { image_url: FOX_DATA_URI },
          { image_url: CAT_DATA_URI },
          { image_url: FOX_DATA_URI },
        ],
      })
      .expect(400);

    expect(response.body.error.message).toContain('3 input images');
    expect(response.body.error.message).toContain('at most 2');
    expect(upstream.requests).toHaveLength(0);
  });

  it('refuses an edit without an input image', async () => {
    const response = await edit()
      .send({ model: 'painter', prompt: PROMPT, images: [] })
      .expect(400);

    expect(response.body.error.code).toBe('invalid_request');
    expect(upstream.requests).toHaveLength(0);
  });

  it('refuses a mask, naming it', async () => {
    const response = await edit()
      .field('model', 'painter')
      .field('prompt', PROMPT)
      .attach('image[]', FOX_PNG, { filename: 'fox.png', contentType: 'image/png' })
      .attach('mask', FOX_PNG, { filename: 'mask.png', contentType: 'image/png' })
      .expect(400);

    expect(response.body.error.message).toContain('mask');
    expect(upstream.requests).toHaveLength(0);
  });

  it('refuses an uploaded file that is not an image, naming its type', async () => {
    const response = await edit()
      .field('model', 'painter')
      .field('prompt', PROMPT)
      .attach('image[]', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(400);

    expect(response.body.error.message).toContain('text/plain');
    expect(upstream.requests).toHaveLength(0);
  });
});
