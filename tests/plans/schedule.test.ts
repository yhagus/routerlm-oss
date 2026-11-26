import { getQueueToken } from '@nestjs/bullmq';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Queue, QueueEvents } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts, upstreamModels } from '@/db/schemas';
import { ProviderKeyCipher } from '@/upstream/providers/provider-key-cipher';
import { FakeUpstream } from '@tests/support/fake-upstream';
import { allowPrivateUpstreams } from '@tests/support/private-upstreams';
import {
  FREE_TIER_PATH,
  freeTierReply,
  insertTokenHarbor,
  MODELS_PATH,
  modelsReply,
} from '@tests/support/tokenharbor-plans';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const tokenHarbor = await FakeUpstream.start();
const { WorkerModule } = await import('@/worker.module');
const { PLANS_QUEUE } = await import('@/queue/models/queue-names');
const { PLAN_READING_SCHEDULER } = await import('@/plans/jobs/plan-reading-schedule');

describe('Scheduled Plan and Plan Coverage readings (e2e)', () => {
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
    queue = worker.get<Queue>(getQueueToken(PLANS_QUEUE));
    queueEvents = new QueueEvents(PLANS_QUEUE, { connection: { url: redisUrl.toString() } });
    await queueEvents.waitUntilReady();
  });

  beforeEach(async () => {
    tokenHarbor.reset();
    await deleteAllUpstreamData(db);
  });

  afterAll(async () => {
    await queueEvents.close();
    await queue.obliterate({ force: true });
    await worker.close();
    await tokenHarbor.close();
  });

  async function insertAccount(providerId: string, isEnabled: boolean): Promise<string> {
    const [account] = await db
      .insert(providerAccounts)
      .values({
        providerId,
        name: `Account ${String(isEnabled)}`,
        encryptedKey: keyCipher.encrypt('th-account-key-0123456789'),
        keyLastFour: '6789',
        isEnabled,
      })
      .returning({ id: providerAccounts.id });
    return account.id;
  }

  async function runReadingTick(): Promise<void> {
    const job = await queue.add('read-plans', {});
    await job.waitUntilFinished(queueEvents);
  }

  it('schedules the repeating reading job when the worker starts', async () => {
    expect(await queue.getJobScheduler(PLAN_READING_SCHEDULER)).toBeTruthy();
  });

  it("reads the enabled accounts' Plans and the Provider's coverage", async () => {
    const providerId = await insertTokenHarbor(db, tokenHarbor.baseUrl, ['glm-5.3']);
    const enabledId = await insertAccount(providerId, true);
    const disabledId = await insertAccount(providerId, false);
    tokenHarbor.replyTo(MODELS_PATH, modelsReply([{ id: 'glm-5.3', coveredByPlans: [] }]));
    tokenHarbor.replyTo(FREE_TIER_PATH, freeTierReply('Agent Pass'));

    await runReadingTick();

    const plans = await db
      .select({ id: providerAccounts.id, plan: providerAccounts.plan })
      .from(providerAccounts);
    const [model] = await db
      .select({ planCoverage: upstreamModels.planCoverage })
      .from(upstreamModels)
      .where(eq(upstreamModels.providerId, providerId));
    expect(Object.fromEntries(plans.map((account) => [account.id, account.plan]))).toEqual({
      [enabledId]: 'Agent Pass',
      [disabledId]: null,
    });
    expect(model.planCoverage).toEqual([]);
  });
});
