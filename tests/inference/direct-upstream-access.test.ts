import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { grantDirectUpstreamAccess, insertUpstreamModel } from '@tests/support/direct-upstream';
import { FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import {
  ALL_CAPABILITIES,
  insertApiKey,
  insertOpenAiChatModel,
  UPSTREAM_MODEL_ID,
} from '@tests/support/inference';
import { deleteAllUpstreamData } from '@tests/support/upstream';
import { writtenUsageLog } from '@tests/support/usage-logs';
import { untilUsageQueueIsDrained } from '@tests/support/usage-queue';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');

const PROVIDER_SLUG = 'acme-smart';
const DIRECT_NAME = `upstream/${PROVIDER_SLUG}/${UPSTREAM_MODEL_ID}`;

describe('Direct Upstream Access (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let providerId: string;
  let providerAccountId: string;
  let apiKey: string;
  let apiKeyId: string;

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
    ({ providerId, providerAccountId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    ({ key: apiKey, id: apiKeyId } = await insertApiKey(app, db));
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

  it('answers model_not_found for an upstream name when the key lacks Direct Upstream Access', async () => {
    const response = await chat(DIRECT_NAME).expect(404);

    expect(response.body.error.code).toBe('model_not_found');
    expect(upstream.requests).toEqual([]);
  });

  it('serves an Upstream Model by its upstream name, recording the exact name and no Model', async () => {
    await grantDirectUpstreamAccess(app, db, apiKeyId);
    upstreamAnswers();

    await chat(DIRECT_NAME).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ model: UPSTREAM_MODEL_ID });
    const usageLog = await writtenUsageLog(db);
    expect(usageLog).toMatchObject({ modelId: null, requestedModelName: DIRECT_NAME });
  });

  it('keeps every slash after the provider slug in the Upstream Model name', async () => {
    await insertUpstreamModel(app, db, providerId, 'vendor/acme-mini');
    await grantDirectUpstreamAccess(app, db, apiKeyId);
    upstreamAnswers();

    await chat(`upstream/${PROVIDER_SLUG}/vendor/acme-mini`).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ model: 'vendor/acme-mini' });
  });

  it('answers model_not_found for an Upstream Model whose Provider has no enabled Provider Account', async () => {
    await grantDirectUpstreamAccess(app, db, apiKeyId);
    await db
      .update(providerAccounts)
      .set({ isEnabled: false })
      .where(eq(providerAccounts.id, providerAccountId));
    await app.get(SnapshotService).changed();

    const response = await chat(DIRECT_NAME).expect(404);

    expect(response.body.error.code).toBe('model_not_found');
  });

  it('lists the usable Upstream Models by their upstream names after the Models', async () => {
    await insertUpstreamModel(app, db, providerId, 'acme-mini');
    await grantDirectUpstreamAccess(app, db, apiKeyId);

    const response = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    const listing = { object: 'model', created: expect.any(Number), kind: 'chat' };
    expect(response.body.data).toEqual([
      { ...listing, id: 'smart', owned_by: 'routerlm', capabilities: ALL_CAPABILITIES },
      { ...listing, id: DIRECT_NAME, owned_by: PROVIDER_SLUG, capabilities: ALL_CAPABILITIES },
      {
        ...listing,
        id: `upstream/${PROVIDER_SLUG}/acme-mini`,
        owned_by: PROVIDER_SLUG,
        capabilities: ALL_CAPABILITIES,
      },
    ]);
  });
});
