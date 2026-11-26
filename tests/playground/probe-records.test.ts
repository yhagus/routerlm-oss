import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { errorCaptures, upstreamModels } from '@/db/schemas';
import { FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import { addProviderAccount, insertOpenAiChatModel, UPSTREAM_KEY } from '@tests/support/inference';
import { deleteAllUpstreamData } from '@tests/support/upstream';
import { untilUsageQueueIsDrained } from '@tests/support/usage-queue';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');
const { writtenUsageLogs } = await import('@tests/support/usage-logs');

const ADA = { email: 'ada@example.com', password: "ada's password" };
const BACKUP_KEY = 'sk-backup-secret-9876543210';
const WORKER_WRITE_TIMEOUT_MS = 5_000;

describe('Records of a Probe (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let adaCookie: string;
  let mainAccountId: string;
  let backupAccountId: string;
  let upstreamModelRowId: string;

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
    adaCookie = await setUpFirstUser(app, ADA);
    let providerId: string;
    ({ providerId, providerAccountId: mainAccountId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    backupAccountId = await addProviderAccount(app, db, providerId, {
      key: BACKUP_KEY,
      priority: 1,
    });
    [{ id: upstreamModelRowId }] = await db.select({ id: upstreamModels.id }).from(upstreamModels);
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  it("writes each call's Usage Log as Playground traffic, and the Error Capture its result names", async () => {
    upstream.replyWithCredential(UPSTREAM_KEY, {
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiChatFixture('upstream-response-tool-call.json')),
    });
    upstream.replyWithCredential(BACKUP_KEY, {
      kind: 'json',
      status: 503,
      body: { error: 'overloaded' },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelRowId}/probe`)
      .set('Cookie', adaCookie)
      .expect(200);

    await vi.waitFor(async () => expect(await writtenUsageLogs(db)).toHaveLength(2), {
      timeout: WORKER_WRITE_TIMEOUT_MS,
    });
    const usageLogs = await writtenUsageLogs(db);
    expect(usageLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isPlayground: true,
          modelId: null,
          routeId: null,
          upstreamModelId: upstreamModelRowId,
          providerAccountId: mainAccountId,
          httpStatus: 200,
        }),
        expect.objectContaining({
          isPlayground: true,
          modelId: null,
          routeId: null,
          httpStatus: 502,
        }),
      ]),
    );
    const failedLog = usageLogs.find((usageLog) => usageLog.httpStatus === 502);
    const [capture] = await db
      .select()
      .from(errorCaptures)
      .where(eq(errorCaptures.id, response.body.results[1].errorCaptureId));
    expect(capture).toMatchObject({
      usageLogId: failedLog?.id,
      responseBody: '{"error":"overloaded"}',
    });
    expect(response.body.results[1]).toMatchObject({ providerAccountId: backupAccountId });
  });
});
