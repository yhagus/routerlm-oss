import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };

const ACME = {
  slug: 'acme',
  name: 'Acme AI',
  endpoints: [{ kind: 'chat', protocol: 'openai-chat', baseUrl: 'https://api.acme.example/v1' }],
  authStyle: 'bearer',
};

describe("A Provider's Terms Risk flag (e2e)", () => {
  let app: NestNodeApplication;
  let cookie: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(app);
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await app.close();
  });

  it('is off unless the Provider is created with it', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send(ACME)
      .expect(201);

    expect(created.body).toMatchObject({ termsRisk: false });
  });

  it('is stored on create and changed on edit', async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/providers')
      .set('Cookie', cookie)
      .send({ ...ACME, termsRisk: true })
      .expect(201);
    expect(created.body).toMatchObject({ termsRisk: true });

    const changed = await request(server)
      .patch(`/api/providers/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ termsRisk: false })
      .expect(200);

    expect(changed.body).toMatchObject({ termsRisk: false });
  });
});
