import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import { ALL_CAPABILITIES, insertApiKey, insertOpenAiChatModel } from '@tests/support/inference';
import { insertModelGroup } from '@tests/support/model-groups';
import { deleteAllUpstreamData } from '@tests/support/upstream';
import { writtenUsageLog } from '@tests/support/usage-logs';
import { untilUsageQueueIsDrained } from '@tests/support/usage-queue';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');

describe('Models published per Model Group (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let apiKey: string;
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
    ({ modelId: smartModelId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    await insertModelGroup(app, db, 'fast', [smartModelId]);
    await insertModelGroup(app, db, 'everyday', [smartModelId]);
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  function chat(model: string) {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ model, messages: [{ role: 'user', content: 'Hello' }] });
  }

  function upstreamAnswers(): void {
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiChatFixture('upstream-response-tool-call.json')),
    });
  }

  it('lists a Model once per Model Group, and a Model without groups under its bare name', async () => {
    await insertOpenAiChatModel(app, db, { modelName: 'legacy', baseUrl: upstream.baseUrl });

    const response = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    const listing = { object: 'model', created: expect.any(Number), kind: 'chat' };
    expect(response.body.data).toEqual([
      { ...listing, id: 'everyday/smart', owned_by: 'everyday', capabilities: ALL_CAPABILITIES },
      { ...listing, id: 'fast/smart', owned_by: 'fast', capabilities: ALL_CAPABILITIES },
      { ...listing, id: 'legacy', owned_by: 'routerlm', capabilities: ALL_CAPABILITIES },
    ]);
  });

  it('serves a Model by its group slug and name, recording what the client asked for', async () => {
    upstreamAnswers();

    await chat('fast/smart').expect(200);

    const usageLog = await writtenUsageLog(db);
    expect(usageLog).toMatchObject({
      modelId: smartModelId,
      modelName: 'smart',
      requestedModelName: 'fast/smart',
    });
  });

  it('still serves a Model by its bare name', async () => {
    upstreamAnswers();

    await chat('smart').expect(200);
  });

  it('answers model_not_found for a group slug the Model is not in', async () => {
    await insertModelGroup(app, db, 'coding');

    const response = await chat('coding/smart').expect(404);

    expect(response.body.error.code).toBe('model_not_found');
    expect(upstream.requests).toHaveLength(0);
  });
});
