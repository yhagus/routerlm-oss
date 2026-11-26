import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { ParameterPolicy } from '@/db/schemas';
import type { Database } from '@/db/schemas/relations';
import {
  FakeUpstream,
  openAiChatFixture,
  openAiResponsesFixture,
} from '@tests/support/fake-upstream';
import {
  insertApiKey,
  insertOpenAiChatModel,
  insertOpenAiResponsesModel,
} from '@tests/support/inference';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const CHAT_REQUEST = { model: 'smart', messages: [{ role: 'user', content: 'Hi' }] };
const OPENAI_TIER_VALUES = { fast: 'priority', flex: 'flex' };

describe('Service Tier (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let cookie: string;
  let key: string;
  let modelId: string;
  let routeId: string;
  let providerId: string;
  let upstreamModelId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    ({ modelId, routeId, providerId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    ({ key } = await insertApiKey(app, db));
    upstreamModelId = await onlyUpstreamModelId();
    await mapOpenAiTiers(providerId);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  async function onlyUpstreamModelId(): Promise<string> {
    const upstreamModels = await request(app.getHttpServer())
      .get('/api/upstream-models')
      .set('Cookie', cookie)
      .expect(200);
    return upstreamModels.body[0].id;
  }

  async function mapOpenAiTiers(id: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/providers/${id}`)
      .set('Cookie', cookie)
      .send({ serviceTierValues: OPENAI_TIER_VALUES })
      .expect(200);
  }

  function setModelPolicy(parameterPolicy: ParameterPolicy) {
    return request(app.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set('Cookie', cookie)
      .send({ parameterPolicy })
      .expect(200);
  }

  function acceptTiers(serviceTiers: string[]) {
    return request(app.getHttpServer())
      .patch(`/api/upstream-models/${upstreamModelId}`)
      .set('Cookie', cookie)
      .send({ serviceTiers })
      .expect(200);
  }

  function replyWithCompletion(): void {
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiChatFixture('upstream-response-tool-call.json')),
    });
  }

  function chat(body: object) {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${key}`)
      .send(body);
  }

  it("sends a Chat Completions client's priority tier as the Provider's fast wire value", async () => {
    await acceptTiers(['fast', 'flex']);
    replyWithCompletion();

    await chat({ ...CHAT_REQUEST, service_tier: 'priority' }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ service_tier: 'priority' });
  });

  it("sends a Responses client's flex tier to an openai-responses upstream", async () => {
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    ({ providerId } = await insertOpenAiResponsesModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    ({ key } = await insertApiKey(app, db));
    upstreamModelId = await onlyUpstreamModelId();
    await mapOpenAiTiers(providerId);
    await acceptTiers(['flex']);
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiResponsesFixture('upstream-response-tool-call.json')),
    });

    await request(app.getHttpServer())
      .post('/v1/responses')
      .set('Authorization', `Bearer ${key}`)
      .send({ model: 'smart', input: 'Hi', service_tier: 'flex' })
      .expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ service_tier: 'flex' });
  });

  it('sends no service_tier when the client asks for auto', async () => {
    await acceptTiers(['fast', 'flex']);
    replyWithCompletion();

    await chat({ ...CHAT_REQUEST, service_tier: 'auto' }).expect(200);

    expect(upstream.lastRequest.body).not.toHaveProperty('service_tier');
  });

  it("drops a tier the Upstream Model doesn't accept and still serves the request on its Route", async () => {
    await acceptTiers(['flex']);
    replyWithCompletion();

    await chat({ ...CHAT_REQUEST, service_tier: 'priority' }).expect(200);

    expect(upstream.requests).toHaveLength(1);
    expect(upstream.lastRequest.body).not.toHaveProperty('service_tier');
  });

  it("ignores an Anthropic Messages client's service_tier", async () => {
    await acceptTiers(['fast', 'flex']);
    replyWithCompletion();

    await request(app.getHttpServer())
      .post('/v1/messages')
      .set('x-api-key', key)
      .send({
        model: 'smart',
        max_tokens: 256,
        messages: [{ role: 'user', content: 'Hi' }],
        service_tier: 'priority',
      })
      .expect(200);

    expect(upstream.lastRequest.body).not.toHaveProperty('service_tier');
  });

  it("fills the Model's default tier when the client asks for none", async () => {
    await acceptTiers(['fast', 'flex']);
    await setModelPolicy({ defaults: { serviceTier: 'flex' } });
    replyWithCompletion();

    await chat(CHAT_REQUEST).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ service_tier: 'flex' });
  });

  it("lets the Model's forced tier replace the client's", async () => {
    await acceptTiers(['fast', 'flex']);
    await setModelPolicy({ forced: { serviceTier: 'fast' } });
    replyWithCompletion();

    await chat({ ...CHAT_REQUEST, service_tier: 'flex' }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ service_tier: 'priority' });
  });

  it("lets a Route override's forced tier win over the Model's", async () => {
    await acceptTiers(['fast', 'flex']);
    await setModelPolicy({ forced: { serviceTier: 'fast' } });
    await request(app.getHttpServer())
      .patch(`/api/models/${modelId}/routes/${routeId}`)
      .set('Cookie', cookie)
      .send({ parameterPolicyOverride: { forced: { serviceTier: 'flex' } } })
      .expect(200);
    replyWithCompletion();

    await chat(CHAT_REQUEST).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ service_tier: 'flex' });
  });
});
