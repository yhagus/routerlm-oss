import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { getDrizzleToken } from '@nestjs/drizzle';
import type { Database } from '@/db/schemas/relations';
import { errorCaptures, settings, usageLogs } from '@/db/schemas';
import { truncateTables } from '@tests/support/truncate';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { WorkerModule } = await import('@/worker.module');
const { ERROR_CAPTURES_QUEUE } = await import('@/queue/models/queue-names');
const { ErrorCaptureRetention, ERROR_CAPTURE_RETENTION_SCHEDULER } =
  await import('@/error-captures/jobs/error-capture-retention');

const NOW = new Date('2026-11-15T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('Error Capture retention (e2e)', () => {
  let worker: TestingModule;
  let db: Database;

  beforeAll(async () => {
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    db = worker.get<Database>(getDrizzleToken());
  });

  afterAll(async () => {
    await worker.get<Queue>(getQueueToken(ERROR_CAPTURES_QUEUE)).obliterate({ force: true });
    await worker.close();
  });

  it('schedules the repeating deletion job when the worker starts', async () => {
    const queue = worker.get<Queue>(getQueueToken(ERROR_CAPTURES_QUEUE));

    expect(await queue.getJobScheduler(ERROR_CAPTURE_RETENTION_SCHEDULER)).toBeTruthy();
  });

  async function insertCapturesAged(...ageDays: number[]) {
    await truncateTables(db, sql.raw('usage_logs'));
    const [{ id: usageLogId }] = await db
      .insert(usageLogs)
      .values({
        createdAt: NOW,
        clientProtocol: 'openai-chat',
        isStreamed: false,
        httpStatus: 502,
        requestBytes: 0,
        responseBytes: 0,
        durationMs: 1,
        attemptCount: 0,
      })
      .returning({ id: usageLogs.id });
    const capture = { usageLogId, requestHeaders: {}, requestBody: '{}' };
    await db.insert(errorCaptures).values(
      ageDays.map((age) => ({
        ...capture,
        requestBody: `${age} days old`,
        createdAt: new Date(NOW.getTime() - age * DAY_MS),
      })),
    );
  }

  async function bodiesLeft() {
    const rows = await db
      .select({ requestBody: errorCaptures.requestBody })
      .from(errorCaptures)
      .orderBy(errorCaptures.requestBody);
    return rows.map((row) => row.requestBody);
  }

  beforeEach(async () => {
    await db.delete(settings).where(eq(settings.key, 'errorCaptureRetentionDays'));
  });

  it('deletes the captures older than the default 7 days and keeps the rest', async () => {
    await insertCapturesAged(8, 6);

    await worker.get(ErrorCaptureRetention).deleteExpiredCaptures(NOW);

    expect(await bodiesLeft()).toEqual(['6 days old']);
  });

  it('applies a changed Retention Period on the next run without a restart', async () => {
    const retention = worker.get(ErrorCaptureRetention);
    await insertCapturesAged(4, 2);
    await retention.deleteExpiredCaptures(NOW);
    expect(await bodiesLeft()).toEqual(['2 days old', '4 days old']);

    await db.insert(settings).values({ key: 'errorCaptureRetentionDays', value: 3 });
    await retention.deleteExpiredCaptures(NOW);

    expect(await bodiesLeft()).toEqual(['2 days old']);
  });
});
