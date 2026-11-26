import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };

const ANTHROPIC_ENDPOINTS = [
  { kind: 'chat', protocol: 'anthropic-messages', baseUrl: 'https://api.acme.example/v1' },
];

const ACME = {
  slug: 'acme',
  name: 'Acme AI',
  endpoints: [{ kind: 'chat', protocol: 'openai-chat', baseUrl: 'https://api.acme.example/v1' }],
  authStyle: 'bearer',
  quirks: { acceptsCacheControl: true },
};

describe("A Provider's quirks fit its Protocol (e2e)", () => {
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

  async function createAcme(): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send(ACME)
      .expect(201);
    return created.body.id;
  }

  function updateProvider(id: string, changes: object) {
    return request(app.getHttpServer())
      .patch(`/api/providers/${id}`)
      .set('Cookie', cookie)
      .send(changes);
  }

  it("refuses to create a Provider with another Protocol's quirk, naming it", async () => {
    const refused = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send({ ...ACME, quirks: { acceptsCacheControl: true, cacheMarkerLimit: 2 } })
      .expect(400);

    expect(refused.body.message).toContain('cacheMarkerLimit');
    expect(refused.body.message).not.toContain('acceptsCacheControl');
  });

  it("refuses quirks that don't fit the stored Protocol", async () => {
    const id = await createAcme();

    const refused = await updateProvider(id, { quirks: { cacheMarkerLimit: 2 } }).expect(400);

    expect(refused.body.message).toContain('cacheMarkerLimit');
  });

  it("refuses a Protocol the stored quirks don't fit", async () => {
    const id = await createAcme();

    const refused = await updateProvider(id, { endpoints: ANTHROPIC_ENDPOINTS }).expect(400);

    expect(refused.body.message).toContain('acceptsCacheControl');
  });

  it("refuses forwardedClientHeaders on a Protocol that doesn't read them", async () => {
    const id = await createAcme();

    const refused = await updateProvider(id, {
      endpoints: ANTHROPIC_ENDPOINTS,
      quirks: { forwardedClientHeaders: ['user-agent'] },
    }).expect(400);

    expect(refused.body.message).toContain('forwardedClientHeaders');
  });

  it.each(['authorization', 'x-api-key', 'cookie', 'host', 'content-length', 'connection'])(
    'refuses to forward the %s header',
    async (header) => {
      const id = await createAcme();

      await updateProvider(id, { quirks: { forwardedClientHeaders: [header] } }).expect(400);
    },
  );

  it("refuses fixedHeaders on a Protocol that doesn't read them", async () => {
    const id = await createAcme();

    const refused = await updateProvider(id, {
      endpoints: ANTHROPIC_ENDPOINTS,
      quirks: { fixedHeaders: { 'x-response-format': 'openai' } },
    }).expect(400);

    expect(refused.body.message).toContain('fixedHeaders');
  });

  it.each(['authorization', 'x-api-key', 'content-type'])(
    'refuses a fixed %s header',
    async (header) => {
      const id = await createAcme();

      await updateProvider(id, { quirks: { fixedHeaders: { [header]: 'value' } } }).expect(400);
    },
  );

  it('takes a new Protocol with its own quirks and the ones every Protocol reads', async () => {
    const id = await createAcme();
    const quirks = {
      cacheMarkerLimit: 2,
      exhaustedErrorCodes: [1308],
      quotaBaseUrl: 'https://quota.acme.example',
    };

    const updated = await updateProvider(id, { endpoints: ANTHROPIC_ENDPOINTS, quirks }).expect(
      200,
    );

    expect(updated.body).toMatchObject({ endpoints: ANTHROPIC_ENDPOINTS, quirks });
  });
});
