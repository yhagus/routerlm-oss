import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { RedisConnection } from '@/redis/providers/redis-connection';
import { createApiKey } from '@tests/support/api-keys';
import { FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import { insertOpenAiChatModel } from '@tests/support/inference';
import { createIntegration } from '@tests/support/integrations';
import { truncateTables } from '@tests/support/truncate';
import { deleteAllUpstreamData } from '@tests/support/upstream';
import { writtenUsageLogs } from '@tests/support/usage-logs';
import { untilUsageQueueIsDrained } from '@tests/support/usage-queue';
import { forgetThrottleCounts } from '@tests/support/redis-state';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');

const ADA = { email: 'ada@example.com', password: "ada's password" };

describe('Request Rate of an API Key (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let adaCookie: string;
  let acme: { id: string; secret: string };

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    usageQueue = app.get<Queue>(getQueueToken(USAGE_QUEUE));
    await usageQueue.obliterate({ force: true });
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await untilUsageQueueIsDrained(usageQueue);
    await deleteAllUpstreamData(db);
    await truncateTables(db, sql.raw('integrations, api_keys, usage_logs'));
    await insertOpenAiChatModel(app, db, { modelName: 'smart', baseUrl: upstream.baseUrl });
    adaCookie = await setUpFirstUser(app, ADA);
    acme = await createIntegration(app, adaCookie, { name: 'Acme SaaS' });
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  function controlPlane() {
    const server = app.getHttpServer();
    const withSecret = (test: request.Test) => test.set('Authorization', `Bearer ${acme.secret}`);
    return {
      issueKey: async (requestRate: number | null): Promise<{ id: string; key: string }> => {
        const created = await withSecret(request(server).post('/integration/v1/keys'))
          .send({ customerId: 'cus_42', requestRate })
          .expect(201);
        return { id: created.body.apiKey.id, key: created.body.key };
      },
      setRequestRate: (id: string, requestRate: number | null) =>
        withSecret(request(server).patch(`/integration/v1/keys/${id}`))
          .send({ requestRate })
          .expect(200),
    };
  }

  function chat(key: string, gateway: NestNodeApplication = app) {
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiChatFixture('upstream-response-tool-call.json')),
    });
    return request(gateway.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${key}`)
      .send({ model: 'smart', messages: [{ role: 'user', content: 'Hello' }] });
  }

  it("refuses the request past the key's Request Rate with 429 and records it", async () => {
    const { id, key } = await controlPlane().issueKey(2);

    await chat(key).expect(200);
    await chat(key).expect(200);
    const refused = await chat(key).expect(429);
    await untilUsageQueueIsDrained(usageQueue);

    expect(refused.body.error).toMatchObject({ code: 'request_rate_exceeded' });
    expect(upstream.requests).toHaveLength(2);
    const logs = await writtenUsageLogs(db);
    expect(logs.filter((log) => log.httpStatus === 429)).toEqual([
      expect.objectContaining({
        apiKeyId: id,
        errorCode: 'request_rate_exceeded',
        errorOrigin: 'client',
        customerId: 'cus_42',
      }),
    ]);
  });

  it('counts each key on its own, and never refuses a key without a Request Rate', async () => {
    const limited = await controlPlane().issueKey(1);
    const unlimited = await controlPlane().issueKey(null);

    await chat(limited.key).expect(200);
    await chat(limited.key).expect(429);

    await chat(unlimited.key).expect(200);
    await chat(unlimited.key).expect(200);
    await chat(unlimited.key).expect(200);
  });

  it('shares the count between gateway processes', async () => {
    const { key } = await controlPlane().issueKey(2);
    const { app: secondGateway } = await createTestApp();
    try {
      await chat(key, app).expect(200);
      await chat(key, secondGateway).expect(200);

      await chat(key, app).expect(429);
    } finally {
      await secondGateway.close();
    }
  });

  it('serves the key again as soon as the window it went over in ends', async () => {
    const { key } = await controlPlane().issueKey(1);
    await chat(key).expect(200);
    await chat(key).expect(429);

    await forgetThrottleCounts(app);

    await chat(key).expect(200);
  });

  it('serves the key again as soon as the Integration raises its Request Rate', async () => {
    const { id, key } = await controlPlane().issueKey(1);
    await chat(key).expect(200);
    await chat(key).expect(429);

    await controlPlane().setRequestRate(id, 5);

    await chat(key).expect(200);
  });

  it('keeps serving the key when Redis is unavailable', async () => {
    const { key } = await controlPlane().issueKey(1);
    const { app: gateway } = await createTestApp();
    try {
      gateway.get(RedisConnection).client.disconnect();

      await chat(key, gateway).expect(200);
      await chat(key, gateway).expect(200);
    } finally {
      await gateway.close();
    }
  });

  it("refuses on every client Protocol in that Protocol's error body, and records each refusal", async () => {
    const { key } = await controlPlane().issueKey(1);
    const server = app.getHttpServer();
    await chat(key).expect(200);
    await untilUsageQueueIsDrained(usageQueue);
    await truncateTables(db, sql.raw('usage_logs'));

    const messages = await request(server)
      .post('/v1/messages')
      .set('x-api-key', key)
      .send({ model: 'smart', max_tokens: 16, messages: [{ role: 'user', content: 'Hello' }] })
      .expect(429);
    const images = await request(server)
      .post('/v1/images/generations')
      .set('Authorization', `Bearer ${key}`)
      .send({ model: 'smart', prompt: 'A lighthouse' })
      .expect(429);
    await untilUsageQueueIsDrained(usageQueue);

    expect(messages.body).toEqual({
      type: 'error',
      error: expect.objectContaining({ type: 'rate_limit_error', code: 'request_rate_exceeded' }),
    });
    expect(images.body.error).toMatchObject({ code: 'request_rate_exceeded' });
    const logs = await writtenUsageLogs(db);
    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientProtocol: 'anthropic-messages',
          errorCode: 'request_rate_exceeded',
          errorOrigin: 'client',
        }),
        expect.objectContaining({
          clientProtocol: 'openai-images',
          errorCode: 'request_rate_exceeded',
          errorOrigin: 'client',
        }),
      ]),
    );
  });

  it('lets a User set and clear the Request Rate of an operator key', async () => {
    const server = app.getHttpServer();
    const { id, key } = await createApiKey(app, adaCookie, { name: 'CI', requestRate: 1 });
    await chat(key).expect(200);
    await chat(key).expect(429);

    const cleared = await request(server)
      .patch(`/api/api-keys/${id}`)
      .set('Cookie', adaCookie)
      .send({ requestRate: null })
      .expect(200);

    await chat(key).expect(200);
    expect(cleared.body).toMatchObject({ requestRate: null });
    const set = await request(server)
      .patch(`/api/api-keys/${id}`)
      .set('Cookie', adaCookie)
      .send({ requestRate: 7 })
      .expect(200);
    expect(set.body).toMatchObject({ requestRate: 7 });
  });
});
