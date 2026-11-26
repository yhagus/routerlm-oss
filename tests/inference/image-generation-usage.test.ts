import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { FakeUpstream, replyWithTwoDashScopeImages } from '@tests/support/fake-upstream';
import { insertApiKey, insertDashScopeImageModel } from '@tests/support/inference';
import { deleteAllUpstreamData } from '@tests/support/upstream';
import { untilUsageQueueIsDrained } from '@tests/support/usage-queue';
import { writtenUsageLog } from '@tests/support/usage-logs';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');

describe('Usage Logs of image generation (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let apiKey: string;

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
    await insertDashScopeImageModel(app, db, {
      modelName: 'painter',
      baseUrl: `${upstream.origin}/api/v1`,
      pricePerImageBySize: { '1K': 0.04, '2K': 0.075 },
      pricePerInputImage: 0.003,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  it("records the images generated, their size tier and their Cost at that tier's price", async () => {
    replyWithTwoDashScopeImages(upstream);

    await request(app.getHttpServer())
      .post('/v1/images/generations')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ model: 'painter', prompt: 'A red fox in snow', n: 2 })
      .expect(200);

    expect(await writtenUsageLog(db)).toMatchObject({
      kind: 'image',
      clientProtocol: 'openai-images',
      imagesOut: 2,
      unitTier: '1K',
      cost: 0.08,
      inputTokens: null,
      outputTokens: null,
      timeToFirstTokenMs: null,
      isIncomplete: false,
    });
  });

  it("prices qwen's standard 1328×1328 at the 1K tier", async () => {
    replyWithTwoDashScopeImages(upstream, { width: 1328, height: 1328 });

    await request(app.getHttpServer())
      .post('/v1/images/generations')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ model: 'painter', prompt: 'A red fox in snow', n: 2 })
      .expect(200);

    expect(await writtenUsageLog(db)).toMatchObject({ unitTier: '1K', cost: 0.08 });
  });

  it('records the input images of an edit, and prices them into its Cost', async () => {
    replyWithTwoDashScopeImages(upstream);

    await request(app.getHttpServer())
      .post('/v1/images/edits')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        model: 'painter',
        prompt: 'Swap the cat for the fox',
        images: [
          { image_url: 'https://images.example.com/fox.png' },
          { image_url: 'https://images.example.com/cat.png' },
        ],
      })
      .expect(200);

    expect(await writtenUsageLog(db)).toMatchObject({ imagesOut: 2, imagesIn: 2, cost: 0.086 });
  });
});
