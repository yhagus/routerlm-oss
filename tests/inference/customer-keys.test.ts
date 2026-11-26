import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { attempts } from '@/db/schemas';
import { FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import { insertOpenAiChatModel } from '@tests/support/inference';
import { createIntegration } from '@tests/support/integrations';
import { deleteAllUpstreamData } from '@tests/support/upstream';
import { writtenUsageLog } from '@tests/support/usage-logs';
import { untilUsageQueueIsDrained } from '@tests/support/usage-queue';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');

const ADA = { email: 'ada@example.com', password: "ada's password" };

describe("Inference with a Customer's API Key (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let adaCookie: string;
  let acme: { id: string; secret: string };
  let smartModelId: string;

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
    await db.execute(sql`truncate table integrations, api_keys cascade`);
    ({ modelId: smartModelId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    adaCookie = await setUpFirstUser(app, ADA);
    acme = await createIntegration(app, adaCookie, { name: 'Acme SaaS' });
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  async function issueCustomerKey(customerId: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/integration/v1/keys')
      .set('Authorization', `Bearer ${acme.secret}`)
      .send({ customerId })
      .expect(201);
    return created.body.key;
  }

  function chat(key: string, model = 'smart') {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${key}`)
      .send({ model, messages: [{ role: 'user', content: 'Hello' }] });
  }

  function upstreamAnswers(): void {
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiChatFixture('upstream-response-tool-call.json')),
    });
  }

  it("serves a Customer's key and records its Integration and Customer", async () => {
    const key = await issueCustomerKey('cus_42');
    upstreamAnswers();

    await chat(key).expect(200);

    const usageLog = await writtenUsageLog(db);
    const written = await db.select().from(attempts).where(eq(attempts.usageLogId, usageLog.id));
    expect(usageLog).toMatchObject({
      integrationId: acme.id,
      integrationName: 'Acme SaaS',
      customerId: 'cus_42',
    });
    expect(written).toEqual([
      expect.objectContaining({ integrationName: 'Acme SaaS', customerId: 'cus_42' }),
    ]);
  });

  it('refuses the keys of a disabled Integration as unknown, and serves them once re-enabled', async () => {
    const key = await issueCustomerKey('cus_42');
    const server = app.getHttpServer();

    await request(server)
      .post(`/api/integrations/${acme.id}/disable`)
      .set('Cookie', adaCookie)
      .expect(204);
    await chat(key).expect(401);
    await request(server)
      .post(`/api/integrations/${acme.id}/enable`)
      .set('Cookie', adaCookie)
      .expect(204);
    upstreamAnswers();
    await chat(key).expect(200);
  });

  it('lets a key with no allowed Models use only the Models its Integration may sell', async () => {
    await insertOpenAiChatModel(app, db, { modelName: 'unsold', baseUrl: upstream.baseUrl });
    await request(app.getHttpServer())
      .patch(`/api/integrations/${acme.id}`)
      .set('Cookie', adaCookie)
      .send({ allowedModelIds: [smartModelId] })
      .expect(200);
    const key = await issueCustomerKey('cus_42');
    upstreamAnswers();

    await chat(key, 'unsold').expect(403);
    await chat(key, 'smart').expect(200);
  });
});
