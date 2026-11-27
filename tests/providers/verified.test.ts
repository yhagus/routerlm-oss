import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };

const ACME = {
  slug: 'acme',
  name: 'Acme AI',
  endpoints: [{ kind: 'chat', protocol: 'openai-chat', baseUrl: 'https://api.acme.example/v1' }],
  authStyle: 'bearer',
};

describe("A Provider's Verified flag (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts Unverified on a Provider the operator adds', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send(ACME)
      .expect(201);

    expect(created.body).toMatchObject({ verified: false, verifiedAt: null });
  });

  it('cannot be set when the Provider is created', async () => {
    await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send({ ...ACME, verified: true })
      .expect(400);
  });

  it('records today when the operator marks the Provider Verified', async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/providers')
      .set('Cookie', cookie)
      .send(ACME)
      .expect(201);
    const markedAfter = Date.now();

    const marked = await request(server)
      .patch(`/api/providers/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ verified: true })
      .expect(200);

    expect(marked.body.verified).toBe(true);
    expect(Date.parse(marked.body.verifiedAt)).toBeGreaterThanOrEqual(markedAfter);
    const listed = await request(server).get('/api/providers').set('Cookie', cookie).expect(200);
    expect(listed.body).toMatchObject([{ verified: true, verifiedAt: marked.body.verifiedAt }]);
  });

  it('clears the day when the operator unmarks the Provider', async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/providers')
      .set('Cookie', cookie)
      .send(ACME)
      .expect(201);
    await request(server)
      .patch(`/api/providers/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ verified: true })
      .expect(200);

    const unmarked = await request(server)
      .patch(`/api/providers/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ verified: false })
      .expect(200);

    expect(unmarked.body).toMatchObject({ verified: false, verifiedAt: null });
  });
});
