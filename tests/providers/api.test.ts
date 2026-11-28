import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData, insertRouteTo } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };

const ACME = {
  slug: 'acme',
  name: 'Acme AI',
  endpoints: [{ kind: 'chat', protocol: 'openai-chat', baseUrl: 'https://api.acme.example/v1' }],
  authStyle: 'bearer',
  quirks: { acceptsCacheControl: true },
};

describe('Providers (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(app);
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAcme(): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send(ACME)
      .expect(201);
    return created.body.id;
  }

  it('adds a Provider that speaks a known Protocol and lists it', async () => {
    await createAcme();

    const list = await request(app.getHttpServer())
      .get('/api/providers')
      .set('Cookie', cookie)
      .expect(200);

    expect(list.body).toEqual([
      expect.objectContaining({ ...ACME, isEnabled: true, isFromCatalog: false }),
    ]);
  });

  it('refuses an unknown Protocol or quirk', async () => {
    const server = app.getHttpServer();

    await request(server)
      .post('/api/providers')
      .set('Cookie', cookie)
      .send({ ...ACME, endpoints: [{ ...ACME.endpoints[0], protocol: 'acme-chat' }] })
      .expect(400);
    await request(server)
      .post('/api/providers')
      .set('Cookie', cookie)
      .send({ ...ACME, quirks: { acceptsCacheControll: true } })
      .expect(400);
  });

  it("refuses an endpoint whose Protocol doesn't serve its Kind", async () => {
    const response = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send({
        ...ACME,
        endpoints: [
          ACME.endpoints[0],
          { kind: 'image', protocol: 'openai-chat', baseUrl: 'https://api.acme.example/v1' },
        ],
      })
      .expect(400);

    expect(JSON.stringify(response.body)).toContain(
      "The Protocol doesn't serve the endpoint's Kind",
    );
  });

  it('refuses a Provider with two endpoints of the same Protocol', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send({
        ...ACME,
        endpoints: [
          ACME.endpoints[0],
          { kind: 'chat', protocol: 'openai-chat', baseUrl: 'https://eu.acme.example/v1' },
        ],
      })
      .expect(400);

    expect(JSON.stringify(response.body)).toContain('at most one endpoint per Protocol');
  });

  it("edits a Provider's endpoints and disables it", async () => {
    const id = await createAcme();
    const euEndpoint = {
      kind: 'chat',
      protocol: 'openai-chat',
      baseUrl: 'https://eu.acme.example/v1',
    };

    const updated = await request(app.getHttpServer())
      .patch(`/api/providers/${id}`)
      .set('Cookie', cookie)
      .send({ endpoints: [euEndpoint], isEnabled: false })
      .expect(200);

    expect(updated.body).toMatchObject({
      slug: ACME.slug,
      endpoints: [euEndpoint],
      quirks: ACME.quirks,
      isEnabled: false,
    });
  });

  it('deletes a Provider', async () => {
    const server = app.getHttpServer();
    const id = await createAcme();

    await request(server).delete(`/api/providers/${id}`).set('Cookie', cookie).expect(204);

    const list = await request(server).get('/api/providers').set('Cookie', cookie).expect(200);
    expect(list.body).toEqual([]);
  });

  it('refuses to delete a Provider whose Upstream Models have Routes, naming the Models', async () => {
    const server = app.getHttpServer();
    const id = await createAcme();
    const upstreamModel = await request(server)
      .post('/api/upstream-models')
      .set('Cookie', cookie)
      .send({
        providerId: id,
        upstreamModelId: 'acme-large',
        capabilities: [],
        contextSize: 128_000,
        maxOutputTokens: null,
        inputPrice: null,
        outputPrice: null,
        cacheReadPrice: null,
        cacheWritePrice: null,
      })
      .expect(201);
    await insertRouteTo(db, upstreamModel.body.id, 'smart');

    const refused = await request(server)
      .delete(`/api/providers/${id}`)
      .set('Cookie', cookie)
      .expect(409);

    expect(refused.body.message).toContain('smart');
  });

  it('needs a signed-in User', async () => {
    await request(app.getHttpServer()).get('/api/providers').expect(401);
  });
});
