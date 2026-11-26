import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts, upstreamModels } from '@/db/schemas';
import { FakeUpstream } from '@tests/support/fake-upstream';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import {
  FREE_TIER_PATH,
  freeTierReply,
  insertTokenHarbor,
  MODELS_PATH,
  modelsReply,
} from '@tests/support/tokenharbor-plans';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const ACCOUNT_KEY = 'th-account-key-0123456789';

describe('Reading the Plan of a TokenHarbor Provider Account when it is added (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let tokenHarbor: FakeUpstream;
  let cookie: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    tokenHarbor = await FakeUpstream.start();
  });

  beforeEach(async () => {
    tokenHarbor.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    providerId = await insertTokenHarbor(db, tokenHarbor.baseUrl, ['glm-5.3']);
  });

  afterAll(async () => {
    await tokenHarbor.close();
    await app.close();
  });

  it("reads the new account's Plan and its Provider's coverage", async () => {
    tokenHarbor.replyTo(FREE_TIER_PATH, freeTierReply('Office Pass'));
    tokenHarbor.replyTo(
      MODELS_PATH,
      modelsReply([{ id: 'glm-5.3', coveredByPlans: ['Office Pass'] }]),
    );

    const created = await request(app.getHttpServer())
      .post('/api/provider-accounts')
      .set('Cookie', cookie)
      .send({ providerId, key: ACCOUNT_KEY })
      .expect(201);

    await vi.waitFor(
      async () => {
        const [account] = await db
          .select({ plan: providerAccounts.plan })
          .from(providerAccounts)
          .where(eq(providerAccounts.id, created.body.id));
        const [model] = await db
          .select({ planCoverage: upstreamModels.planCoverage })
          .from(upstreamModels)
          .where(eq(upstreamModels.providerId, providerId));
        expect([account.plan, model.planCoverage]).toEqual(['Office Pass', ['Office Pass']]);
      },
      { timeout: 2_000, interval: 50 },
    );
  });
});
