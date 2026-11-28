import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import type { UsageJob } from '@/usage/models/usage-job';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');
const { UsageProducer } = await import('@/usage/jobs/usage.producer');

const ALL_ATTEMPTS_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 100;

function unwritableUsageJob(): UsageJob {
  return {
    usageLogId: randomUUID(),
    receivedAt: new Date().toISOString(),
    caller: { kind: 'api-key', apiKeyId: randomUUID(), apiKeyName: 'Deleted key', customer: null },
    modelId: null,
    modelName: null,
    requestedModelName: null,
    clientProtocol: 'openai-chat',
    isStreamed: false,
    httpStatus: 500,
    errorCode: null,
    errorOrigin: 'gateway',
    userAgent: null,
    clientIp: null,
    servedBy: null,
    usage: null,
    units: null,
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
    errorCapture: {
      requestCaptureId: randomUUID(),
      request: { headers: {}, body: 'a secret prompt' },
      failedAttempts: [],
    },
  };
}

describe('Usage jobs that fail (e2e)', () => {
  let app: NestNodeApplication;
  let worker: TestingModule;
  let usageQueue: Queue;

  beforeAll(async () => {
    ({ app } = await createTestApp());
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

  it(
    'leaves nothing in Redis once a job has failed all its attempts',
    async () => {
      app.get(UsageProducer).enqueue(unwritableUsageJob());

      const deadline = Date.now() + ALL_ATTEMPTS_TIMEOUT_MS;
      let counts = await usageQueue.getJobCounts('waiting', 'active', 'delayed', 'failed');
      let sawJob = false;
      while (Date.now() < deadline) {
        counts = await usageQueue.getJobCounts('waiting', 'active', 'delayed', 'failed');
        const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
        sawJob ||= total > 0;
        if (sawJob && total === 0) break;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      expect(sawJob).toBe(true);
      expect(counts.failed).toBe(0);
      expect(await usageQueue.getJobCountByTypes('failed', 'completed')).toBe(0);
    },
    ALL_ATTEMPTS_TIMEOUT_MS + 5_000,
  );
});
