import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { type FakeReply, FakeUpstream } from '@tests/support/fake-upstream';
import { insertApiKey, insertOpenAiChatModel } from '@tests/support/inference';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const TEXT_REQUEST = { model: 'smart', messages: [{ role: 'user', content: 'Hi' }] };
const SERVER_ERROR: FakeReply = { kind: 'json', status: 503, body: { error: 'overloaded' } };
const FIRST_COOLDOWN_MS = 5_000;
const ONE_HOUR_MS = 60 * 60_000;
const SECOND_FAILURE_TEST_TIMEOUT_MS = 15_000;

function rateLimitedWithRetryAfter(retryAfter: string): FakeReply {
  return {
    kind: 'json',
    status: 429,
    body: { error: 'slow down' },
    headers: { 'retry-after': retryAfter },
  };
}

interface ObservedCooldown {
  endsAt: number;
  requestSentAt: number;
  requestAnsweredAt: number;
}

describe('Provider Account Cooldown (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let cookie: string;
  let providerAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(app);
    ({ providerAccountId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    ({ key: apiKey } = await insertApiKey(app, db));
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  async function cooldownEndsAt(): Promise<number | null> {
    const listed = await request(app.getHttpServer())
      .get('/api/provider-accounts')
      .set('Cookie', cookie)
      .expect(200);
    const account = listed.body.find(
      (candidate: { id: string }) => candidate.id === providerAccountId,
    );
    return account.cooldownEndsAt === null ? null : Date.parse(account.cooldownEndsAt);
  }

  async function failRequestWith(reply: FakeReply): Promise<ObservedCooldown> {
    upstream.reply(reply);
    const requestSentAt = Date.now();
    await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(TEXT_REQUEST);
    const requestAnsweredAt = Date.now();
    const endsAt = await cooldownEndsAt();
    if (endsAt === null) {
      throw new Error('The failed Provider Account is not in Cooldown');
    }
    return { endsAt, requestSentAt, requestAnsweredAt };
  }

  function expectToLast(cooldown: ObservedCooldown, durationMs: number): void {
    expect(cooldown.endsAt).toBeGreaterThanOrEqual(cooldown.requestSentAt + durationMs);
    expect(cooldown.endsAt).toBeLessThanOrEqual(cooldown.requestAnsweredAt + durationMs);
  }

  it('cools a failed Provider Account down for 5 seconds at first', async () => {
    expectToLast(await failRequestWith(SERVER_ERROR), FIRST_COOLDOWN_MS);
  });

  it(
    'doubles the Cooldown when the Provider Account fails again once it is over',
    async () => {
      await failRequestWith(SERVER_ERROR);
      await vi.waitFor(async () => expect(await cooldownEndsAt()).toBeNull(), {
        timeout: FIRST_COOLDOWN_MS + 2_000,
        interval: 250,
      });

      expectToLast(await failRequestWith(SERVER_ERROR), 2 * FIRST_COOLDOWN_MS);
    },
    SECOND_FAILURE_TEST_TIMEOUT_MS,
  );

  it('waits as long as a Retry-After in seconds asks', async () => {
    expectToLast(await failRequestWith(rateLimitedWithRetryAfter('120')), 120_000);
  });

  it('waits until a Retry-After date', async () => {
    const retryAt = Math.ceil(Date.now() / 1000) * 1000 + 30_000;

    const cooldown = await failRequestWith(
      rateLimitedWithRetryAfter(new Date(retryAt).toUTCString()),
    );

    expect(cooldown.endsAt).toBeGreaterThanOrEqual(retryAt);
    expect(cooldown.endsAt).toBeLessThanOrEqual(
      retryAt + cooldown.requestAnsweredAt - cooldown.requestSentAt,
    );
  });

  it('does not shorten the Cooldown for a shorter Retry-After', async () => {
    expectToLast(await failRequestWith(rateLimitedWithRetryAfter('1')), FIRST_COOLDOWN_MS);
  });

  it('waits at most one hour, whatever Retry-After asks', async () => {
    expectToLast(await failRequestWith(rateLimitedWithRetryAfter('86400')), ONE_HOUR_MS);
  });

  it('ignores a Retry-After it cannot read', async () => {
    expectToLast(await failRequestWith(rateLimitedWithRetryAfter('soon')), FIRST_COOLDOWN_MS);
  });
});
