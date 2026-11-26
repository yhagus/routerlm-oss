import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { attempts, providerAccounts, upstreamModels } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { type FakeReply, FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import {
  addProviderAccount,
  insertApiKey,
  insertOpenAiChatModel,
  setProviderQuirks,
  UPSTREAM_KEY,
} from '@tests/support/inference';
import { deleteAllUpstreamData } from '@tests/support/upstream';
import { untilUsageQueueIsDrained } from '@tests/support/usage-queue';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');

const BACKUP_KEY = 'sk-backup-secret-9876543210';
const TEXT_REQUEST = { model: 'smart', messages: [{ role: 'user', content: 'Hi' }] };
const AGENT_PASS = 'agent';
const OFFICE_PASS = 'office';

const SUCCESS: FakeReply = {
  kind: 'json',
  status: 200,
  body: JSON.parse(openAiChatFixture('upstream-response-tool-call.json')),
};
const NOT_IN_PLAN: FakeReply = {
  kind: 'json',
  status: 402,
  body: { error: { code: 'model_not_in_plan', message: 'Top up your wallet' } },
};

describe('Plan Coverage (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let worker: TestingModule;
  let usageQueue: Queue;
  let apiKey: string;
  let providerId: string;
  let primaryAccountId: string;
  let backupAccountId: string;

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
    ({ providerId, providerAccountId: primaryAccountId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    backupAccountId = await addProviderAccount(app, db, providerId, {
      key: BACKUP_KEY,
      priority: 1,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await app.close();
  });

  function chat() {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(TEXT_REQUEST);
  }

  function attemptedKeys(): string[] {
    return upstream.requests.map((received) =>
      String(received.headers.authorization).replace('Bearer ', ''),
    );
  }

  async function holdPlan(
    providerAccountId: string,
    plan: string | null,
    paysBeyondPlan = false,
  ): Promise<void> {
    await db
      .update(providerAccounts)
      .set({ plan, paysBeyondPlan })
      .where(eq(providerAccounts.id, providerAccountId));
    await app.get(SnapshotService).changed();
  }

  async function coverModelBy(planCoverage: string[] | null): Promise<void> {
    await db
      .update(upstreamModels)
      .set({ planCoverage })
      .where(eq(upstreamModels.providerId, providerId));
    await app.get(SnapshotService).changed();
  }

  it('skips a Provider Account whose Plan does not cover the Upstream Model', async () => {
    await holdPlan(primaryAccountId, AGENT_PASS);
    await coverModelBy([OFFICE_PASS]);
    upstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([BACKUP_KEY]);
  });

  it('lets a Provider Account that pays beyond its Plan serve an uncovered Upstream Model', async () => {
    await holdPlan(primaryAccountId, AGENT_PASS, true);
    await coverModelBy([OFFICE_PASS]);
    upstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
  });

  it('serves an Upstream Model with unknown coverage from a Provider Account on a Plan', async () => {
    await holdPlan(primaryAccountId, AGENT_PASS);
    await coverModelBy(null);
    upstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
  });

  it('serves a covered Upstream Model from a Provider Account with no Plan', async () => {
    await coverModelBy([OFFICE_PASS]);
    upstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
  });

  it('answers as if no account were usable when every Provider Account is outside the coverage', async () => {
    await holdPlan(primaryAccountId, AGENT_PASS);
    await holdPlan(backupAccountId, AGENT_PASS);
    await coverModelBy([OFFICE_PASS]);

    const response = await chat().expect(502);

    expect(response.body.error.message).toBe('No upstream is available for this Model');
    expect(attemptedKeys()).toEqual([]);
  });

  describe('when the Provider refuses a model as outside the Plan', () => {
    beforeEach(async () => {
      await setProviderQuirks(app, db, providerId, { notInPlanErrorCodes: ['model_not_in_plan'] });
    });

    it('falls back to the next Provider Account without a Cooldown', async () => {
      upstream.reply(NOT_IN_PLAN);
      upstream.reply(SUCCESS);
      upstream.reply(SUCCESS);

      await chat().expect(200);
      await chat().expect(200);

      expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY, UPSTREAM_KEY]);
    });

    it('records the refused Attempt as not in the Plan', async () => {
      upstream.reply(NOT_IN_PLAN);
      upstream.reply(SUCCESS);

      await chat().expect(200);
      await untilUsageQueueIsDrained(usageQueue);

      const recorded = await db.select().from(attempts);
      expect(
        recorded.map(({ providerAccountId, failureReason }) => ({
          providerAccountId,
          failureReason,
        })),
      ).toEqual(
        expect.arrayContaining([
          { providerAccountId: primaryAccountId, failureReason: 'not_in_plan' },
          { providerAccountId: backupAccountId, failureReason: null },
        ]),
      );
    });
  });
});
