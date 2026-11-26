import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import {
  DASHSCOPE_GENERATION_PATH,
  FakeUpstream,
  replyWithTwoDashScopeImages,
} from '@tests/support/fake-upstream';
import { insertApiKey, insertDashScopeImageModel } from '@tests/support/inference';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };

describe('Watermark on DashScope media requests (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  it("sends the watermark on when the Model's Parameter Policy, saved from the dashboard, forces it", async () => {
    const cookie = await setUpFirstUser(app, OPERATOR);
    const { modelId } = await insertDashScopeImageModel(app, db, {
      modelName: 'painter',
      baseUrl: `${upstream.origin}/api/v1`,
    });
    const { key } = await insertApiKey(app, db);
    await request(app.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set('Cookie', cookie)
      .send({ parameterPolicy: { forced: { watermark: true } } })
      .expect(200);
    replyWithTwoDashScopeImages(upstream);

    await request(app.getHttpServer())
      .post('/v1/images/generations')
      .set('Authorization', `Bearer ${key}`)
      .send({ model: 'painter', prompt: 'A red fox in snow' })
      .expect(200);

    const [sent] = upstream.requests.filter(
      (received) => received.path === DASHSCOPE_GENERATION_PATH,
    );
    expect(sent.body).toMatchObject({ parameters: { watermark: true } });
  });
});
