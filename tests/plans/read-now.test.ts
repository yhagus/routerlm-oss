import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts, providers, upstreamModels } from '@/db/schemas';
import { FakeUpstream } from '@tests/support/fake-upstream';
import { addProviderAccount } from '@tests/support/inference';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import {
  FREE_TIER_PATH,
  freeTierReply,
  insertTokenHarbor,
  MODELS_PATH,
  modelsReply,
  SERVER_ERROR_REPLY,
} from '@tests/support/tokenharbor-plans';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const ACCOUNT_KEY = 'th-account-key-0123456789';
const AGENT_PASS = 'Agent Pass';
const LAST_CHECK = new Date('2026-11-20T10:00:00Z');

describe('Reading the Plan of a TokenHarbor Provider Account on demand (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let tokenHarbor: FakeUpstream;
  let cookie: string;
  let providerId: string;
  let accountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    tokenHarbor = await FakeUpstream.start();
  });

  beforeEach(async () => {
    tokenHarbor.reset();
    await deleteAllUpstreamData(app);
    cookie = await setUpFirstUser(app, OPERATOR);
    providerId = await insertTokenHarbor(db, tokenHarbor.baseUrl, [
      'glm-5.3',
      'claude-opus-5.5',
      'gpt-6.2-sol',
      'kept-model',
    ]);
    accountId = await addProviderAccount(app, db, providerId, { key: ACCOUNT_KEY, priority: 0 });
  });

  afterAll(async () => {
    await tokenHarbor.close();
    await app.close();
  });

  function readPlanNow(providerAccountId: string) {
    return request(app.getHttpServer())
      .post(`/api/provider-accounts/${providerAccountId}/plan`)
      .set('Cookie', cookie);
  }

  async function coverageOf(upstreamModelId: string) {
    const [model] = await db
      .select({
        planCoverage: upstreamModels.planCoverage,
        planCoverageCheckedAt: upstreamModels.planCoverageCheckedAt,
      })
      .from(upstreamModels)
      .where(eq(upstreamModels.upstreamModelId, upstreamModelId));
    return model;
  }

  it("reads the account's Plan with its key and returns the updated account", async () => {
    tokenHarbor.replyTo(FREE_TIER_PATH, freeTierReply(AGENT_PASS));
    tokenHarbor.replyTo(MODELS_PATH, modelsReply([]));

    const response = await readPlanNow(accountId).expect(200);

    expect(response.body).toMatchObject({
      id: accountId,
      plan: AGENT_PASS,
      planCheckedAt: expect.any(String),
    });
    expect(response.body).not.toHaveProperty('encryptedKey');
    const freeTierCall = tokenHarbor.requests.find((call) => call.path === FREE_TIER_PATH);
    expect(freeTierCall?.headers.authorization).toBe(`Bearer ${ACCOUNT_KEY}`);
  });

  it('stores an empty plan name as no Plan', async () => {
    await db
      .update(providerAccounts)
      .set({ plan: AGENT_PASS, planCheckedAt: LAST_CHECK })
      .where(eq(providerAccounts.id, accountId));
    tokenHarbor.replyTo(FREE_TIER_PATH, freeTierReply(''));
    tokenHarbor.replyTo(MODELS_PATH, modelsReply([]));

    const response = await readPlanNow(accountId).expect(200);

    expect(response.body.plan).toBeNull();
    expect(new Date(response.body.planCheckedAt).getTime()).toBeGreaterThan(LAST_CHECK.getTime());
  });

  it("writes each listed model's coverage as the Provider reports it, unknown and empty included", async () => {
    tokenHarbor.replyTo(FREE_TIER_PATH, freeTierReply(AGENT_PASS));
    tokenHarbor.replyTo(
      MODELS_PATH,
      modelsReply([
        { id: 'glm-5.3', coveredByPlans: ['Agent Pass', 'Office Pass'] },
        { id: 'claude-opus-5.5', coveredByPlans: [] },
        { id: 'gpt-6.2-sol', coveredByPlans: null },
        { id: 'not-in-this-gateway', coveredByPlans: ['Agent Pass'] },
      ]),
    );

    await readPlanNow(accountId).expect(200);

    const [glm, claude, gpt] = await Promise.all([
      coverageOf('glm-5.3'),
      coverageOf('claude-opus-5.5'),
      coverageOf('gpt-6.2-sol'),
    ]);
    expect([glm.planCoverage, claude.planCoverage, gpt.planCoverage]).toEqual([
      ['Agent Pass', 'Office Pass'],
      [],
      null,
    ]);
    expect(gpt.planCoverageCheckedAt).toBeInstanceOf(Date);
  });

  it('lists the read coverage on the dashboard', async () => {
    tokenHarbor.replyTo(FREE_TIER_PATH, freeTierReply(AGENT_PASS));
    tokenHarbor.replyTo(
      MODELS_PATH,
      modelsReply([{ id: 'glm-5.3', coveredByPlans: ['Agent Pass'] }]),
    );
    await readPlanNow(accountId).expect(200);

    const list = await request(app.getHttpServer())
      .get('/api/upstream-models')
      .set('Cookie', cookie)
      .expect(200);

    expect(
      list.body.find((model: { upstreamModelId: string }) => model.upstreamModelId === 'glm-5.3'),
    ).toMatchObject({ planCoverage: ['Agent Pass'], planCoverageCheckedAt: expect.any(String) });
  });

  it('leaves the coverage of models missing from the listing untouched', async () => {
    await db
      .update(upstreamModels)
      .set({ planCoverage: ['Frontier Pass'], planCoverageCheckedAt: LAST_CHECK })
      .where(eq(upstreamModels.upstreamModelId, 'kept-model'));
    tokenHarbor.replyTo(FREE_TIER_PATH, freeTierReply(AGENT_PASS));
    tokenHarbor.replyTo(
      MODELS_PATH,
      modelsReply([{ id: 'glm-5.3', coveredByPlans: ['Agent Pass'] }]),
    );

    await readPlanNow(accountId).expect(200);

    expect(await coverageOf('kept-model')).toEqual({
      planCoverage: ['Frontier Pass'],
      planCoverageCheckedAt: LAST_CHECK,
    });
  });

  it('keeps the last Plan and coverage when TokenHarbor fails to answer', async () => {
    await db
      .update(providerAccounts)
      .set({ plan: AGENT_PASS, planCheckedAt: LAST_CHECK })
      .where(eq(providerAccounts.id, accountId));
    await db
      .update(upstreamModels)
      .set({ planCoverage: ['Agent Pass'], planCoverageCheckedAt: LAST_CHECK })
      .where(eq(upstreamModels.upstreamModelId, 'glm-5.3'));
    tokenHarbor.replyTo(FREE_TIER_PATH, SERVER_ERROR_REPLY);
    tokenHarbor.replyTo(MODELS_PATH, SERVER_ERROR_REPLY);

    const response = await readPlanNow(accountId).expect(200);

    expect(response.body).toMatchObject({
      plan: AGENT_PASS,
      planCheckedAt: LAST_CHECK.toISOString(),
    });
    expect(await coverageOf('glm-5.3')).toEqual({
      planCoverage: ['Agent Pass'],
      planCoverageCheckedAt: LAST_CHECK,
    });
  });

  it('reads coverage with the first enabled account by priority', async () => {
    const firstKey = 'th-first-key-0123456789';
    await addProviderAccount(app, db, providerId, { key: 'th-disabled-key-0123456', priority: -2 });
    await db
      .update(providerAccounts)
      .set({ isEnabled: false })
      .where(eq(providerAccounts.priority, -2));
    await addProviderAccount(app, db, providerId, { key: firstKey, priority: -1 });
    tokenHarbor.replyTo(FREE_TIER_PATH, freeTierReply(AGENT_PASS));
    tokenHarbor.replyTo(MODELS_PATH, modelsReply([]));

    await readPlanNow(accountId).expect(200);

    const modelsCall = tokenHarbor.requests.find((call) => call.path === MODELS_PATH);
    expect(modelsCall?.headers.authorization).toBe(`Bearer ${firstKey}`);
  });

  it('refuses a Provider Account whose Provider reports no Plan', async () => {
    await db.update(providers).set({ planReader: null }).where(eq(providers.id, providerId));

    await readPlanNow(accountId).expect(400);

    expect(tokenHarbor.requests).toHaveLength(0);
  });
});
