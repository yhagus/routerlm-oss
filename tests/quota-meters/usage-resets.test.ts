import { randomUUID } from 'node:crypto';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';
import type { CatalogProvider } from '@/catalog/schemas/catalog.schema';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts, providers } from '@/db/schemas';
import { FakeUpstream, type ReceivedRequest } from '@tests/support/fake-upstream';
import { insertOpenAiResponsesModel } from '@tests/support/inference';
import {
  ACCOUNT_ID,
  accessToken,
  addCodexLoginAccount,
  offerCodexOauthLogin,
} from '@tests/support/openai-codex-oauth';
import {
  CONSUME_PATH,
  consumeReply,
  RESET_CREDITS_PATH,
  resetCredit,
  resetCreditsReply,
  USAGE_PATH,
  usageAtPercentReply,
} from '@tests/support/openai-codex-usage';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const HOUR_SECONDS = 3600;
const HOUR_MS = HOUR_SECONDS * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('Usage Resets of an OpenAI Codex Provider Account (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let openAi: FakeUpstream;
  let catalogCodex: CatalogProvider;
  let cookie: string;
  let providerId: string;
  let token: string;
  let accountId: string;
  let windowResetsAt: Date;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    openAi = await FakeUpstream.start();
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const codex = catalog.find((provider) => provider.slug === 'openai-codex');
    if (!codex) throw new Error('the Catalog has no OpenAI Codex Provider');
    catalogCodex = codex;
  });

  beforeEach(async () => {
    openAi.reset();
    await deleteAllUpstreamData(app);
    cookie = await setUpFirstUser(app, OPERATOR);
    ({ providerId } = await insertOpenAiResponsesModel(app, db, {
      modelName: 'smart',
      baseUrl: openAi.baseUrl,
    }));
    await db
      .update(providers)
      .set({ quirks: catalogCodex.quirks, quotaReader: catalogCodex.quotaReader ?? null })
      .where(eq(providers.id, providerId));
    await offerCodexOauthLogin(db, providerId, openAi.origin);
    token = accessToken('granted', HOUR_SECONDS);
    accountId = await addCodexLoginAccount(app, db, providerId, {
      accessToken: token,
      refreshToken: 'codex-refresh-token-0123',
    });
    windowResetsAt = new Date(Date.now() + 3 * HOUR_MS);
  });

  afterAll(async () => {
    await openAi.close();
    await app.close();
  });

  function readQuotaNow() {
    return request(app.getHttpServer())
      .post(`/api/provider-accounts/${accountId}/quota-reading`)
      .set('Cookie', cookie)
      .expect(200);
  }

  function useReset(resetId: string, body: object = { idempotencyKey: randomUUID() }) {
    return request(app.getHttpServer())
      .post(`/api/provider-accounts/${accountId}/usage-resets/${resetId}/use`)
      .set('Cookie', cookie)
      .send(body);
  }

  async function listedAccount(): Promise<Record<string, unknown>> {
    const list = await request(app.getHttpServer())
      .get('/api/provider-accounts')
      .set('Cookie', cookie)
      .expect(200);
    return list.body.find((account: { id: string }) => account.id === accountId);
  }

  function callsTo(path: string): ReceivedRequest[] {
    return openAi.requests.filter((received) => received.path === path);
  }

  async function storeOneReset(usedPercent = 50): Promise<string> {
    openAi.replyTo(USAGE_PATH, usageAtPercentReply(usedPercent, windowResetsAt, 1));
    openAi.replyTo(
      RESET_CREDITS_PATH,
      resetCreditsReply([resetCredit('credit-a', new Date(Date.now() + DAY_MS))]),
    );
    const reading = await readQuotaNow();
    return reading.body.usageResets[0].id;
  }

  it("fetches the list when the reading's count differs, and not again while it agrees", async () => {
    const soon = new Date(Date.now() + DAY_MS);
    const later = new Date(Date.now() + 7 * DAY_MS);
    openAi.replyTo(USAGE_PATH, usageAtPercentReply(50, windowResetsAt, 3));
    openAi.replyTo(USAGE_PATH, usageAtPercentReply(50, windowResetsAt, 3));
    openAi.replyTo(
      RESET_CREDITS_PATH,
      resetCreditsReply([
        resetCredit('never-expires', null),
        resetCredit('later', later),
        resetCredit('soon', soon),
        resetCredit('being-spent', later, 'redeeming'),
      ]),
    );

    const first = await readQuotaNow();
    const second = await readQuotaNow();

    expect(callsTo(RESET_CREDITS_PATH)).toHaveLength(1);
    expect(callsTo(RESET_CREDITS_PATH)[0].headers).toMatchObject({
      authorization: `Bearer ${token}`,
      'chatgpt-account-id': ACCOUNT_ID,
    });
    const listed = [
      {
        id: expect.any(String),
        title: 'Reset soon',
        grantedAt: expect.any(String),
        expiresAt: soon.toISOString(),
      },
      {
        id: expect.any(String),
        title: 'Reset later',
        grantedAt: expect.any(String),
        expiresAt: later.toISOString(),
      },
      {
        id: expect.any(String),
        title: 'Reset never-expires',
        grantedAt: expect.any(String),
        expiresAt: null,
      },
    ];
    expect(first.body.usageResets).toEqual(listed);
    expect(second.body.usageResets).toEqual(first.body.usageResets);
    expect(await listedAccount()).toMatchObject({ usageResets: first.body.usageResets });
  });

  it('neither lists nor counts a reset that has expired', async () => {
    openAi.replyTo(USAGE_PATH, usageAtPercentReply(50, windowResetsAt, 1));
    openAi.replyTo(USAGE_PATH, usageAtPercentReply(50, windowResetsAt, 1));
    openAi.replyTo(
      RESET_CREDITS_PATH,
      resetCreditsReply([
        resetCredit('valid', new Date(Date.now() + DAY_MS)),
        resetCredit('expired', new Date(Date.now() - HOUR_MS)),
      ]),
    );

    await readQuotaNow();
    const second = await readQuotaNow();

    expect(second.body.usageResets).toEqual([expect.objectContaining({ title: 'Reset valid' })]);
    expect(callsTo(RESET_CREDITS_PATH)).toHaveLength(1);
  });

  it('keeps the reading and the stored resets when the list fetch fails', async () => {
    const resetId = await storeOneReset();
    openAi.replyTo(USAGE_PATH, usageAtPercentReply(20, windowResetsAt, 2));
    openAi.replyTo(RESET_CREDITS_PATH, { kind: 'json', status: 500, body: {} });

    const reading = await readQuotaNow();

    expect(callsTo(RESET_CREDITS_PATH)).toHaveLength(2);
    expect(reading.body).toMatchObject({
      quotaError: null,
      quotaMeters: [
        expect.objectContaining({ remainingPercent: 80 }),
        expect.objectContaining({ remainingPercent: 80 }),
      ],
      usageResets: [expect.objectContaining({ id: resetId })],
    });
  });

  it('spends a reset with the idempotency key, then refreshes the list and meters and ends Exhausted', async () => {
    const resetId = await storeOneReset(100);
    expect(await listedAccount()).toMatchObject({ cooldownCause: 'exhausted' });
    openAi.replyTo(CONSUME_PATH, consumeReply('reset'));
    openAi.replyTo(RESET_CREDITS_PATH, resetCreditsReply([]));
    openAi.replyTo(USAGE_PATH, usageAtPercentReply(0, windowResetsAt, 0));
    const idempotencyKey = randomUUID();

    const used = await useReset(resetId, { idempotencyKey }).expect(200);

    expect(callsTo(CONSUME_PATH)).toEqual([
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: `Bearer ${token}`,
          'chatgpt-account-id': ACCOUNT_ID,
        }),
        body: { redeem_request_id: idempotencyKey, credit_id: 'credit-a' },
      }),
    ]);
    expect(callsTo(RESET_CREDITS_PATH)).toHaveLength(2);
    expect(used.body).toMatchObject({
      quotaError: null,
      quotaMeters: [
        expect.objectContaining({ remainingPercent: 100 }),
        expect.objectContaining({ remainingPercent: 100 }),
      ],
      usageResets: [],
    });
    expect(await listedAccount()).toMatchObject({ cooldownCause: null, usageResets: [] });
  });

  it('answers 409 without fetching the list when no meter is low enough to reset', async () => {
    const resetId = await storeOneReset();
    openAi.replyTo(CONSUME_PATH, consumeReply('nothing_to_reset'));

    const refused = await useReset(resetId).expect(409);

    expect(refused.body.message).toBe('No meter is low enough to reset yet');
    expect(callsTo(RESET_CREDITS_PATH)).toHaveLength(1);
  });

  it('answers 409 and fetches the list again when the reset was already spent', async () => {
    const resetId = await storeOneReset();
    openAi.replyTo(CONSUME_PATH, consumeReply('already_redeemed'));
    openAi.replyTo(RESET_CREDITS_PATH, resetCreditsReply([]));

    const refused = await useReset(resetId).expect(409);

    expect(refused.body.message).toBe('That reset is no longer available');
    expect(callsTo(RESET_CREDITS_PATH)).toHaveLength(2);
    expect(await listedAccount()).toMatchObject({ usageResets: [] });
  });

  it('answers 502 naming the endpoint when spending fails, and shows the error on the account', async () => {
    const resetId = await storeOneReset();
    openAi.replyTo(CONSUME_PATH, { kind: 'json', status: 401, body: {} });

    const failed = await useReset(resetId).expect(502);

    const message = 'The OpenAI usage resets endpoint answered HTTP 401';
    expect(failed.body.message).toBe(message);
    expect(await listedAccount()).toMatchObject({
      quotaError: message,
      usageResets: [expect.objectContaining({ id: resetId })],
    });
  });

  it('answers the fresh reading and keeps the stored list when the list fetch fails after spending', async () => {
    const resetId = await storeOneReset(100);
    openAi.replyTo(CONSUME_PATH, consumeReply('reset'));
    openAi.replyTo(RESET_CREDITS_PATH, { kind: 'json', status: 500, body: {} });
    openAi.replyTo(USAGE_PATH, usageAtPercentReply(0, windowResetsAt, 0));

    const used = await useReset(resetId).expect(200);

    expect(used.body).toMatchObject({
      quotaError: null,
      quotaMeters: [
        expect.objectContaining({ remainingPercent: 100 }),
        expect.objectContaining({ remainingPercent: 100 }),
      ],
      usageResets: [expect.objectContaining({ id: resetId })],
    });
    expect(await listedAccount()).toMatchObject({ cooldownCause: null });
  });

  it('spends a reset of a disabled Provider Account', async () => {
    const resetId = await storeOneReset();
    await db
      .update(providerAccounts)
      .set({ isEnabled: false })
      .where(eq(providerAccounts.id, accountId));
    openAi.replyTo(CONSUME_PATH, consumeReply('reset'));
    openAi.replyTo(RESET_CREDITS_PATH, resetCreditsReply([]));
    openAi.replyTo(USAGE_PATH, usageAtPercentReply(0, windowResetsAt, 0));

    const used = await useReset(resetId).expect(200);

    expect(callsTo(CONSUME_PATH)).toHaveLength(1);
    expect(used.body).toMatchObject({ quotaError: null, usageResets: [] });
  });

  it("answers 409 when the account's Provider has no usage resets", async () => {
    const resetId = await storeOneReset();
    await db
      .update(providers)
      .set({ quotaReader: 'kimi-code' })
      .where(eq(providers.id, providerId));

    const refused = await useReset(resetId).expect(409);

    expect(refused.body.message).toBe('The Provider of this Provider Account has no usage resets');
    expect(callsTo(CONSUME_PATH)).toHaveLength(0);
  });

  it('answers 404 for a reset the account does not hold, without calling OpenAI', async () => {
    await storeOneReset();

    await useReset(randomUUID()).expect(404);

    expect(callsTo(CONSUME_PATH)).toHaveLength(0);
  });

  it('refuses a body without an idempotency key', async () => {
    const resetId = await storeOneReset();

    await useReset(resetId, {}).expect(400);

    expect(callsTo(CONSUME_PATH)).toHaveLength(0);
  });
});
