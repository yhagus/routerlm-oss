import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const OPENAI_CHAT_ENDPOINT = {
  kind: 'chat',
  protocol: 'openai-chat',
  baseUrl: 'https://api.acme.example/v1',
};
const ANTHROPIC_MESSAGES_ENDPOINT = {
  kind: 'chat',
  protocol: 'anthropic-messages',
  baseUrl: 'https://api.acme.example',
};
const ACME_LARGE = {
  upstreamModelId: 'acme-large',
  name: 'Acme Large',
  capabilities: [],
  contextSize: 200_000,
  maxOutputTokens: 32_000,
  inputPrice: 3,
  outputPrice: 15,
  cacheReadPrice: null,
  cacheWritePrice: null,
  releaseDate: '2026-02-10',
};

describe('The Protocols an Upstream Model lists (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    const provider = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send({
        slug: 'acme',
        name: 'Acme AI',
        endpoints: [OPENAI_CHAT_ENDPOINT, ANTHROPIC_MESSAGES_ENDPOINT],
        authStyle: 'bearer',
      })
      .expect(201);
    providerId = provider.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function createAcmeLarge(protocols: string[]) {
    return request(app.getHttpServer())
      .post('/api/upstream-models')
      .set('Cookie', cookie)
      .send({ providerId, ...ACME_LARGE, protocols });
  }

  it('keeps the Protocols in the order they are listed', async () => {
    const created = await createAcmeLarge(['anthropic-messages', 'openai-chat']).expect(201);

    expect(created.body.protocols).toEqual(['anthropic-messages', 'openai-chat']);
  });

  it('refuses a Protocol the Provider has no endpoint for, naming it', async () => {
    const response = await createAcmeLarge(['openai-responses']).expect(400);

    expect(response.body.message).toBe(
      'The Provider has no chat endpoint for the Protocols openai-responses',
    );
  });

  it('refuses removing a Provider Endpoint an Upstream Model lists, naming the model', async () => {
    await createAcmeLarge(['anthropic-messages']).expect(201);

    const response = await request(app.getHttpServer())
      .patch(`/api/providers/${providerId}`)
      .set('Cookie', cookie)
      .send({ endpoints: [OPENAI_CHAT_ENDPOINT] })
      .expect(400);

    expect(response.body.message).toContain('"acme-large"');
  });
});
