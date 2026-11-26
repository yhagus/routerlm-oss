import { getQueueToken } from '@nestjs/bullmq';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Queue, QueueEvents } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { type QuotaReaderName, providerAccounts, providers, quotaMeters } from '@/db/schemas';
import { ProviderKeyCipher } from '@/upstream/providers/provider-key-cipher';
import { FakeUpstream } from '@tests/support/fake-upstream';
import { USAGES_PATH, usagesReply } from '@tests/support/kimi-code-usages';
import { remainsAtPercentReply } from '@tests/support/minimax-m-plan-remains';
import { allowPrivateUpstreams } from '@tests/support/private-upstreams';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const fakeUpstream = await FakeUpstream.start();
const { WorkerModule } = await import('@/worker.module');
const { QUOTA_METERS_QUEUE } = await import('@/queue/models/queue-names');
const { QUOTA_READING_SCHEDULER } = await import('@/quota-meters/jobs/quota-reading-schedule');

const MINUTE_MS = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE_MS);
}

describe('Scheduled Quota Meter readings (e2e)', () => {
  let worker: TestingModule;
  let db: Database;
  let queue: Queue;
  let queueEvents: QueueEvents;
  const keyCipher = new ProviderKeyCipher(process.env.ENCRYPTION_KEY ?? '');

  beforeAll(async () => {
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    await allowPrivateUpstreams(worker, true);
    db = worker.get<Database>(getDrizzleToken());
    queue = worker.get<Queue>(getQueueToken(QUOTA_METERS_QUEUE));
    queueEvents = new QueueEvents(QUOTA_METERS_QUEUE, { connection: { url: redisUrl.toString() } });
    await queueEvents.waitUntilReady();
  });

  beforeEach(async () => {
    fakeUpstream.reset();
    await deleteAllUpstreamData(db);
  });

  afterAll(async () => {
    await queueEvents.close();
    await queue.obliterate({ force: true });
    await worker.close();
    await fakeUpstream.close();
  });

  async function insertAccount(
    quotaReader: QuotaReaderName | null,
    fields: { isEnabled?: boolean } = {},
  ): Promise<string> {
    const [provider] = await db
      .insert(providers)
      .values({
        slug: `plan-${quotaReader ?? 'none'}`,
        name: 'Plan',
        endpoints: [
          { kind: 'chat', protocol: 'anthropic-messages', baseUrl: fakeUpstream.baseUrl },
        ],
        authStyle: 'bearer',
        quirks: { quotaBaseUrl: fakeUpstream.baseUrl },
        quotaReader,
      })
      .onConflictDoUpdate({ target: providers.slug, set: { name: 'Plan' } })
      .returning({ id: providers.id });
    const [account] = await db
      .insert(providerAccounts)
      .values({
        providerId: provider.id,
        name: `Account ${Math.random()}`,
        encryptedKey: keyCipher.encrypt('sk-cp-0123456789abcdef'),
        keyLastFour: 'cdef',
        ...fields,
      })
      .returning({ id: providerAccounts.id });
    return account.id;
  }

  async function runReadingTick(): Promise<void> {
    const job = await queue.add('read-due-accounts', {});
    await job.waitUntilFinished(queueEvents);
  }

  async function lastReadMinutesAgo(providerAccountId: string, minutes: number): Promise<void> {
    await db
      .update(providerAccounts)
      .set({ quotaCheckedAt: minutesAgo(minutes) })
      .where(eq(providerAccounts.id, providerAccountId));
  }

  it('schedules the repeating reading job when the worker starts', async () => {
    expect(await queue.getJobScheduler(QUOTA_READING_SCHEDULER)).toBeTruthy();
  });

  it('reads enabled accounts at Providers with a reader, and no others', async () => {
    const readAccountId = await insertAccount('minimax-m-plan');
    await insertAccount('minimax-m-plan', { isEnabled: false });
    await insertAccount(null);
    fakeUpstream.reply(remainsAtPercentReply(50));

    await runReadingTick();

    expect(fakeUpstream.requests).toHaveLength(1);
    const [account] = await db
      .select({ quotaCheckedAt: providerAccounts.quotaCheckedAt })
      .from(providerAccounts)
      .where(eq(providerAccounts.id, readAccountId));
    expect(account.quotaCheckedAt).not.toBeNull();
  });

  it("reads a Kimi Code account's meters from its Provider's base URL", async () => {
    const accountId = await insertAccount('kimi-code');
    fakeUpstream.reply(usagesReply());

    await runReadingTick();

    expect(fakeUpstream.lastRequest.path).toBe(USAGES_PATH);
    const meters = await db
      .select({ key: quotaMeters.key })
      .from(quotaMeters)
      .where(eq(quotaMeters.providerAccountId, accountId));
    expect(meters.map((meter) => meter.key).sort()).toEqual([
      '5h',
      '7d',
      'month-code',
      'month-total',
    ]);
  });

  it('reads every minute while a meter is below 10%, and every 5 minutes once it recovers', async () => {
    const accountId = await insertAccount('minimax-m-plan');
    fakeUpstream.reply(remainsAtPercentReply(8));
    await runReadingTick();

    fakeUpstream.reply(remainsAtPercentReply(50));
    await lastReadMinutesAgo(accountId, 1);
    await runReadingTick();
    await lastReadMinutesAgo(accountId, 1);
    await runReadingTick();
    expect(fakeUpstream.requests).toHaveLength(2);

    fakeUpstream.reply(remainsAtPercentReply(50));
    await lastReadMinutesAgo(accountId, 5);
    await runReadingTick();
    expect(fakeUpstream.requests).toHaveLength(3);
  });
});
