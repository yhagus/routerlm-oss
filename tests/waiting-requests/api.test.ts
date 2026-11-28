import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { apiKeys, providerAccounts } from '@/db/schemas';
import type { Database } from '@/db/schemas/relations';
import { RedisConnection } from '@/redis/providers/redis-connection';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type {
  WaitingRequestCount,
  WaitingRequestList,
} from '@/waiting-requests/models/waiting-requests';
import { type FakeReply, FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import { addProviderAccount, insertApiKey, insertOpenAiChatModel } from '@tests/support/inference';
import { portOf } from '@tests/support/port-of';
import { forgetConcurrencySlots } from '@tests/support/redis-state';
import { truncateTables } from '@tests/support/truncate';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import('@tests/support/test-app');

const ADA = { email: 'ada@example.com', password: "ada's password" };
const BACKUP_KEY = 'sk-backup-secret-9876543210';
const TEXT_REQUEST = { model: 'smart', messages: [{ role: 'user', content: 'Hi' }] };
const SUCCESS_BODY: unknown = JSON.parse(openAiChatFixture('upstream-response-tool-call.json'));
const SUCCESS: FakeReply = { kind: 'json', status: 200, body: SUCCESS_BODY };
const WAITING_CLIENT = 'waiting-client/1.0';
const DEFAULT_WAIT_BUDGET_MS = 60_000;
const EMPTY_LIST: WaitingRequestList = { available: true, lines: [], requests: [] };

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

describe('Waiting Requests API (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let baseUrl: string;
  let adaCookie: string;
  let apiKey: { key: string; id: string };
  let primaryAccountId: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
    baseUrl = `http://127.0.0.1:${portOf((await app.listen(0, '127.0.0.1')).address())}`;
  });

  beforeEach(async () => {
    upstream.reset();
    await forgetConcurrencySlots(app);
    await deleteAllUpstreamData(app);
    await truncateTables(app, sql.raw('api_keys'));
    ({ providerAccountId: primaryAccountId, providerId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    apiKey = await insertApiKey(app, db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await upstream.close();
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

  function chat(): Promise<Response> {
    return fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey.key}`,
        'content-type': 'application/json',
        'user-agent': WAITING_CLIENT,
      },
      body: JSON.stringify(TEXT_REQUEST),
    });
  }

  async function waitingRequests(target = app): Promise<WaitingRequestList> {
    const response = await request(target.getHttpServer())
      .get('/api/waiting-requests')
      .set('Cookie', adaCookie)
      .expect(200);
    const body: WaitingRequestList = response.body;
    return body;
  }

  async function waitingCount(target = app): Promise<WaitingRequestCount> {
    const response = await request(target.getHttpServer())
      .get('/api/waiting-requests/count')
      .set('Cookie', adaCookie)
      .expect(200);
    const body: WaitingRequestCount = response.body;
    return body;
  }

  async function untilUpstreamReceived(count: number): Promise<void> {
    while (upstream.requests.length < count) {
      await sleep(10);
    }
  }

  async function untilWaiting(count: number): Promise<void> {
    while ((await waitingCount()).count < count) {
      await sleep(20);
    }
  }

  it('lists a request waiting for its API Key with its place and line, until its slot frees', async () => {
    await limitApiKey(1);
    const first = heldReply();
    upstream.reply(first.reply);
    upstream.reply(SUCCESS);

    const firstResponse = chat();
    await untilUpstreamReceived(1);
    const waitingResponse = chat();
    await untilWaiting(1);
    const { available, lines, requests } = await waitingRequests();
    const apiKeyHolder = { kind: 'api-key', id: apiKey.id, apiKeyName: 'client' };

    expect(available).toBe(true);
    expect(lines).toEqual([{ holder: apiKeyHolder, limit: 1, running: 1, waiting: 1 }]);
    expect(requests).toEqual([
      {
        id: expect.any(String),
        waitingSince: expect.any(String),
        deadline: expect.any(String),
        waitedMs: expect.any(Number),
        msUntilRefused: expect.any(Number),
        waitsFor: { kind: 'api-key', apiKeyId: apiKey.id },
        caller: { kind: 'api-key', apiKeyId: apiKey.id, apiKeyName: 'client', customer: null },
        requestedModelName: 'smart',
        isStreamed: false,
        clientIp: expect.any(String),
        userAgent: WAITING_CLIENT,
        bestPlace: { place: 1, holder: apiKeyHolder },
        otherHolders: [],
      },
    ]);
    expect(requests[0].msUntilRefused).toBeGreaterThan(0);
    expect(requests[0].msUntilRefused).toBeLessThanOrEqual(DEFAULT_WAIT_BUDGET_MS);

    first.answer();
    expect((await firstResponse).status).toBe(200);
    expect((await waitingResponse).status).toBe(200);
    expect(await waitingRequests()).toEqual(EMPTY_LIST);
    expect(await waitingCount()).toEqual({ available: true, count: 0 });
  });

  it('lists a request waiting for several Provider Accounts once, at its best place', async () => {
    const backupAccountId = await addProviderAccount(app, db, providerId, {
      key: BACKUP_KEY,
      priority: 1,
    });
    await limitProviderAccount(primaryAccountId, 1);
    await limitProviderAccount(backupAccountId, 1);
    const first = heldReply();
    const second = heldReply();
    upstream.reply(first.reply);
    upstream.reply(second.reply);
    upstream.reply(SUCCESS);

    const firstResponse = chat();
    await untilUpstreamReceived(1);
    const secondResponse = chat();
    await untilUpstreamReceived(2);
    const waitingResponse = chat();
    await untilWaiting(1);
    const { lines, requests } = await waitingRequests();
    const [waiting] = requests;
    const holderIds = [waiting.bestPlace.holder.id, ...waiting.otherHolders.map(({ id }) => id)];

    expect(requests).toHaveLength(1);
    expect(waiting.waitsFor).toEqual({
      kind: 'provider-accounts',
      providerAccountIds: expect.arrayContaining([primaryAccountId, backupAccountId]),
    });
    expect(waiting.bestPlace.place).toBe(1);
    expect(waiting.bestPlace.holder).toMatchObject({
      kind: 'provider-account',
      providerName: 'Acme',
    });
    expect(holderIds.toSorted()).toEqual([primaryAccountId, backupAccountId].toSorted());
    expect(lines).toHaveLength(2);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ limit: 1, running: 1, waiting: 1 }),
        expect.objectContaining({ limit: 1, running: 1, waiting: 1 }),
      ]),
    );

    first.answer();
    second.answer();
    expect((await firstResponse).status).toBe(200);
    expect((await secondResponse).status).toBe(200);
    expect((await waitingResponse).status).toBe(200);
  });

  it('says the lines are unavailable while Redis is unreachable', async () => {
    const { app: gateway } = await createTestApp();
    try {
      gateway.get(RedisConnection).client.disconnect();

      expect(await waitingRequests(gateway)).toEqual({
        available: false,
        lines: [],
        requests: [],
      });
      expect(await waitingCount(gateway)).toEqual({ available: false, count: 0 });
    } finally {
      await gateway.close();
    }
  });

  it('refuses a caller without a dashboard session', async () => {
    await request(app.getHttpServer()).get('/api/waiting-requests').expect(401);
    await request(app.getHttpServer()).get('/api/waiting-requests/count').expect(401);
  });
});
