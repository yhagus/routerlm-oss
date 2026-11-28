import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { apiKeys, errorCaptures, providerAccounts, upstreamModels } from '@/db/schemas';
import type { Database } from '@/db/schemas/relations';
import { RedisConnection } from '@/redis/providers/redis-connection';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { type FakeReply, FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import {
  addProviderAccount,
  insertApiKey,
  insertOpenAiChatModel,
  UPSTREAM_KEY,
} from '@tests/support/inference';
import { portOf } from '@tests/support/port-of';
import { forgetConcurrencySlots } from '@tests/support/redis-state';
import { truncateTables } from '@tests/support/truncate';
import { deleteAllUpstreamData } from '@tests/support/upstream';
import { writtenUsageLogs } from '@tests/support/usage-logs';
import { untilUsageQueueIsDrained } from '@tests/support/usage-queue';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');

const ADA = { email: 'ada@example.com', password: "ada's password" };
const BACKUP_KEY = 'sk-backup-secret-9876543210';
const TEXT_REQUEST = { model: 'smart', messages: [{ role: 'user', content: 'Hi' }] };
const SUCCESS_BODY: unknown = JSON.parse(openAiChatFixture('upstream-response-tool-call.json'));
const STREAM_EVENTS = openAiChatFixture('upstream-stream-tool-call.sse');
const FIRST_STREAM_CHUNK = STREAM_EVENTS.split('\n\n')[0] + '\n\n';
const LONGER_THAN_A_WAKE_UP_MS = 700;
const MESSAGES_REQUEST = {
  model: 'smart',
  max_tokens: 64,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
};
const OUTLIVES_A_STALE_WAITER_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface HeldReply {
  reply: FakeReply;
  answer: () => void;
}

function heldReply(): HeldReply {
  let answer = (): void => {};
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  return {
    reply: { kind: 'json', status: 200, body: SUCCESS_BODY, onReceived: () => answered },
    answer,
  };
}

const SUCCESS: FakeReply = { kind: 'json', status: 200, body: SUCCESS_BODY };

describe('Concurrency Limit (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let baseUrl: string;
  let adaCookie: string;
  let apiKey: { key: string; id: string };
  let primaryAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    usageQueue = app.get<Queue>(getQueueToken(USAGE_QUEUE));
    await usageQueue.obliterate({ force: true });
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    upstream = await FakeUpstream.start();
    baseUrl = `http://127.0.0.1:${portOf((await app.listen(0, '127.0.0.1')).address())}`;
  });

  beforeEach(async () => {
    upstream.reset();
    await forgetConcurrencySlots(app);
    await untilUsageQueueIsDrained(usageQueue);
    await deleteAllUpstreamData(app, worker);
    await truncateTables(app, sql.raw('api_keys, usage_logs'), worker);
    ({ providerAccountId: primaryAccountId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    apiKey = await insertApiKey(app, db);
    adaCookie = await setUpFirstUser(app, ADA);
    await request(app.getHttpServer())
      .delete('/api/settings/concurrency-wait')
      .set('Cookie', adaCookie)
      .expect(200);
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  async function limitApiKey(concurrencyLimit: number): Promise<void> {
    await db.update(apiKeys).set({ concurrencyLimit }).where(eq(apiKeys.id, apiKey.id));
    await app.get(SnapshotService).changed();
  }

  async function limitProviderAccount(id: string, concurrencyLimit: number): Promise<void> {
    await db.update(providerAccounts).set({ concurrencyLimit }).where(eq(providerAccounts.id, id));
    await app.get(SnapshotService).changed();
  }

  function chat(
    options: { stream?: boolean; signal?: AbortSignal; gateway?: string } = {},
  ): Promise<Response> {
    return fetch(`${options.gateway ?? baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...TEXT_REQUEST, stream: options.stream ?? false }),
      signal: options.signal,
    });
  }

  async function setWaitBudget(seconds: number): Promise<void> {
    await request(app.getHttpServer())
      .put('/api/settings/concurrency-wait')
      .set('Cookie', adaCookie)
      .send({ seconds })
      .expect(200);
  }

  async function untilUpstreamReceived(count: number): Promise<void> {
    while (upstream.requests.length < count) {
      await sleep(10);
    }
  }

  function credentialsSentUpstream(): string[] {
    return upstream.requests.map((received) =>
      String(received.headers.authorization).replace('Bearer ', ''),
    );
  }

  it("makes a request past the API Key's limit wait for a slot, and records the wait", async () => {
    await limitApiKey(1);
    const first = heldReply();
    upstream.reply(first.reply);
    upstream.reply(SUCCESS);

    const firstResponse = chat();
    await untilUpstreamReceived(1);
    const secondResponse = chat();
    await sleep(LONGER_THAN_A_WAKE_UP_MS);
    expect(upstream.requests).toHaveLength(1);
    first.answer();

    expect((await firstResponse).status).toBe(200);
    expect((await secondResponse).status).toBe(200);
    await untilUsageQueueIsDrained(usageQueue);
    const waits = (await writtenUsageLogs(db)).map((log) => log.slotWaitMs).sort((a, b) => a - b);
    expect(waits[0]).toBe(0);
    expect(waits[1]).toBeGreaterThanOrEqual(LONGER_THAN_A_WAKE_UP_MS);
  });

  it('refuses a request still waiting when the wait budget runs out, with 429, Retry-After and an Error Capture', async () => {
    await setWaitBudget(1);
    await limitApiKey(1);
    const first = heldReply();
    upstream.reply(first.reply);

    const firstResponse = chat();
    await untilUpstreamReceived(1);
    const refused = await chat();
    first.answer();
    await firstResponse;
    await untilUsageQueueIsDrained(usageQueue);

    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(await refused.json()).toMatchObject({ error: { code: 'concurrency_wait_exceeded' } });
    const refusal = (await writtenUsageLogs(db)).find((log) => log.httpStatus === 429);
    expect(refusal).toMatchObject({
      errorCode: 'concurrency_wait_exceeded',
      errorOrigin: 'client',
    });
    expect(refusal?.slotWaitMs).toBeGreaterThanOrEqual(900);
    const captures = await db.select().from(errorCaptures);
    expect(captures.map((capture) => capture.usageLogId)).toEqual([refusal?.id]);
  });

  it('passes over a Provider Account at its limit to one with a free slot, without waiting', async () => {
    const backupAccountId = await addProviderAccount(
      app,
      db,
      await providerIdOf(primaryAccountId),
      {
        key: BACKUP_KEY,
        priority: 1,
      },
    );
    await limitProviderAccount(primaryAccountId, 1);
    await limitProviderAccount(backupAccountId, 5);
    const first = heldReply();
    upstream.replyWithCredential(UPSTREAM_KEY, first.reply);
    upstream.replyWithCredential(BACKUP_KEY, SUCCESS);

    const firstResponse = chat();
    await untilUpstreamReceived(1);
    const second = await chat();
    first.answer();
    await firstResponse;

    expect(second.status).toBe(200);
    expect(credentialsSentUpstream()).toEqual([UPSTREAM_KEY, BACKUP_KEY]);
  });

  it('waits when every Provider Account is at its limit, and is served by the first that frees', async () => {
    await limitProviderAccount(primaryAccountId, 1);
    const first = heldReply();
    upstream.reply(first.reply);
    upstream.reply(SUCCESS);

    const firstResponse = chat();
    await untilUpstreamReceived(1);
    const secondResponse = chat();
    await sleep(LONGER_THAN_A_WAKE_UP_MS);
    expect(upstream.requests).toHaveLength(1);
    first.answer();

    expect((await firstResponse).status).toBe(200);
    expect((await secondResponse).status).toBe(200);
    expect(credentialsSentUpstream()).toEqual([UPSTREAM_KEY, UPSTREAM_KEY]);
  });

  it.each([
    ['API Key', (): Promise<void> => limitApiKey(1)],
    ['Provider Account', (): Promise<void> => limitProviderAccount(primaryAccountId, 1)],
  ])("holds the %s's slot until the stream ends", async (_holder, limit) => {
    await limit();
    upstream.reply({ kind: 'stream', events: FIRST_STREAM_CHUNK, holdOpen: true });
    upstream.reply(SUCCESS);
    const streamingClient = new AbortController();

    const streaming = await chat({ stream: true, signal: streamingClient.signal });
    await streaming.body?.getReader().read();
    const waitingResponse = chat();
    await sleep(LONGER_THAN_A_WAKE_UP_MS);
    expect(upstream.requests).toHaveLength(1);
    streamingClient.abort();

    expect((await waitingResponse).status).toBe(200);
    expect(upstream.requests).toHaveLength(2);
  });

  it('gives up the place in line of a client that disconnects while waiting, and records nothing for it', async () => {
    await limitApiKey(1);
    const first = heldReply();
    upstream.reply(first.reply);
    upstream.reply(SUCCESS);

    const firstResponse = chat();
    await untilUpstreamReceived(1);
    const leavingClient = new AbortController();
    const leaving = chat({ signal: leavingClient.signal }).catch(() => null);
    await sleep(100);
    leavingClient.abort();
    await leaving;
    const thirdResponse = chat();
    await sleep(100);
    first.answer();

    expect((await firstResponse).status).toBe(200);
    expect((await thirdResponse).status).toBe(200);
    await sleep(LONGER_THAN_A_WAKE_UP_MS);
    await untilUsageQueueIsDrained(usageQueue);
    expect(upstream.requests).toHaveLength(2);
    expect(await writtenUsageLogs(db)).toHaveLength(2);
  });

  it('frees the slot of an attempt that fails before reaching the upstream', async () => {
    await setWaitBudget(1);
    await limitProviderAccount(primaryAccountId, 1);
    await db
      .update(upstreamModels)
      .set({ protocols: ['openai-chat', 'anthropic-messages'] })
      .where(eq(upstreamModels.providerId, await providerIdOf(primaryAccountId)));
    await app.get(SnapshotService).changed();
    upstream.reply(SUCCESS);

    const failed = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey.key, 'content-type': 'application/json' },
      body: JSON.stringify(MESSAGES_REQUEST),
    });
    const next = await chat();

    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(next.status).toBe(200);
  });

  it(
    'lets the line move past a waiter whose gateway lost Redis',
    async () => {
      await setWaitBudget(10);
      await limitApiKey(1);
      const { app: gateway } = await createTestApp();
      try {
        const gatewayUrl = `http://127.0.0.1:${portOf((await gateway.listen(0, '127.0.0.1')).address())}`;
        const first = heldReply();
        upstream.reply(first.reply);
        upstream.reply(SUCCESS);
        upstream.reply(SUCCESS);

        const firstResponse = chat();
        await untilUpstreamReceived(1);
        const vanishingWaiter = chat({ gateway: gatewayUrl });
        await sleep(LONGER_THAN_A_WAKE_UP_MS);
        gateway.get(RedisConnection).client.disconnect();
        await vanishingWaiter;
        const waitingResponse = chat();
        await sleep(LONGER_THAN_A_WAKE_UP_MS);
        first.answer();
        const startedMs = performance.now();

        expect((await firstResponse).status).toBe(200);
        expect((await waitingResponse).status).toBe(200);
        expect(performance.now() - startedMs).toBeLessThan(6_000);
      } finally {
        await gateway.close();
      }
    },
    OUTLIVES_A_STALE_WAITER_MS,
  );

  it('lets requests through without waiting while Redis is unavailable', async () => {
    await limitApiKey(1);
    await limitProviderAccount(primaryAccountId, 1);
    const { app: gateway } = await createTestApp();
    try {
      const gatewayUrl = `http://127.0.0.1:${portOf((await gateway.listen(0, '127.0.0.1')).address())}`;
      gateway.get(RedisConnection).client.disconnect();
      const first = heldReply();
      upstream.reply(first.reply);
      upstream.reply(SUCCESS);

      const firstResponse = chat({ gateway: gatewayUrl });
      await untilUpstreamReceived(1);
      const second = await chat({ gateway: gatewayUrl });
      first.answer();

      expect(second.status).toBe(200);
      expect((await firstResponse).status).toBe(200);
    } finally {
      await gateway.close();
    }
  });

  async function providerIdOf(providerAccountId: string): Promise<string> {
    const [account] = await db
      .select({ providerId: providerAccounts.providerId })
      .from(providerAccounts)
      .where(eq(providerAccounts.id, providerAccountId));
    return account.providerId;
  }
});
