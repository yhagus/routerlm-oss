import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { usageLogs } from '@/db/schemas';
import type { UsageJob } from '@/usage/models/usage-job';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');
const { UsageProducer } = await import('@/usage/jobs/usage.producer');

const WORKER_WRITE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;

function servedUsageJob(units: UsageJob['units']): UsageJob {
  return {
    usageLogId: randomUUID(),
    receivedAt: new Date().toISOString(),
    caller: { kind: 'unidentified' },
    modelId: null,
    modelName: null,
    requestedModelName: null,
    clientProtocol: 'openai-chat',
    isStreamed: false,
    httpStatus: 200,
    errorCode: null,
    errorOrigin: null,
    userAgent: null,
    clientIp: null,
    servedBy: null,
    usage: null,
    units,
    requestBytes: 0,
    responseBytes: 0,
    timeToFirstTokenMs: null,
    isReasoningStreamed: false,
    finishReason: null,
    sentParameters: null,
    toolCount: 0,
    toolCallCount: 0,
    durationMs: 1,
    slotWaitMs: 0,
    isCancelled: false,
    attempts: [],
    errorCapture: null,
  };
}

describe('Usage Log units (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let usageQueue: Queue;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    usageQueue = app.get<Queue>(getQueueToken(USAGE_QUEUE));
    await usageQueue.obliterate({ force: true });
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
  });

  afterAll(async () => {
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  async function writtenUsageLog(job: UsageJob) {
    app.get(UsageProducer).enqueue(job);
    const deadline = Date.now() + WORKER_WRITE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const [usageLog] = await db.select().from(usageLogs).where(eq(usageLogs.id, job.usageLogId));
      if (usageLog) {
        return usageLog;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error('The worker wrote no Usage Log');
  }

  it('records the units a media request counted, and the tier that priced them', async () => {
    const usageLog = await writtenUsageLog(
      servedUsageJob({
        imagesOut: 2,
        imagesIn: 1,
        outputSeconds: 5,
        audioSeconds: 12.5,
        characters: 300,
        tier: '2K',
      }),
    );

    expect(usageLog).toMatchObject({
      imagesOut: 2,
      imagesIn: 1,
      outputSeconds: 5,
      audioSeconds: 12.5,
      characters: 300,
      unitTier: '2K',
    });
  });

  it('records a chat request with its Kind and no units', async () => {
    const usageLog = await writtenUsageLog(servedUsageJob(null));

    expect(usageLog).toMatchObject({
      kind: 'chat',
      imagesOut: null,
      imagesIn: null,
      outputSeconds: null,
      audioSeconds: null,
      characters: null,
      unitTier: null,
    });
  });
});
