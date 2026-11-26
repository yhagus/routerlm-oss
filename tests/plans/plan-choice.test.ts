import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { type ProviderPlan, providers } from '@/db/schemas';
import { FakeUpstream } from '@tests/support/fake-upstream';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { insertTokenHarbor } from '@tests/support/tokenharbor-plans';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const ACCOUNT_KEY = 'th-account-key-0123456789';
const PASSES: ProviderPlan[] = [
  { value: 'Agent Pass', name: 'Agent Pass' },
  { value: 'Office Pass', name: 'Office Pass' },
];

describe('Choosing the Plan of a Provider Account (e2e)', () => {
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
    providerId = await insertTokenHarbor(db, tokenHarbor.baseUrl, []);
  });

  afterAll(async () => {
    await tokenHarbor.close();
    await app.close();
  });

  async function listPlans(plans: ProviderPlan[], allowsNoPlan: boolean): Promise<void> {
    await db.update(providers).set({ plans, allowsNoPlan }).where(eq(providers.id, providerId));
  }

  function addAccount(fields: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/provider-accounts')
      .set('Cookie', cookie)
      .send({ providerId, key: ACCOUNT_KEY, ...fields });
  }

  function changeAccount(providerAccountId: string, fields: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/provider-accounts/${providerAccountId}`)
      .set('Cookie', cookie)
      .send(fields);
  }

  it('takes the Plan read from the Provider until an operator chooses one', async () => {
    await listPlans(PASSES, false);

    const created = await addAccount().expect(201);

    expect(created.body).toMatchObject({ planChoice: 'auto', plan: null });
  });

  it('sets a listed Plan when the account is added and changes it later', async () => {
    await listPlans(PASSES, true);

    const created = await addAccount({ planChoice: 'Agent Pass' }).expect(201);
    const changed = await changeAccount(created.body.id, { planChoice: 'none' }).expect(200);

    expect([created.body.planChoice, changed.body.planChoice]).toEqual(['Agent Pass', 'none']);
  });

  it('refuses a Plan the Provider does not list', async () => {
    await listPlans(PASSES, true);

    const refused = await addAccount({ planChoice: 'Frontier Pass' }).expect(400);

    expect(refused.body.message).toBe(
      'TokenHarbor offers no Plan Choice "Frontier Pass"; choose one of "auto", "none", "Agent Pass", "Office Pass"',
    );
  });

  it('refuses None where the Provider does not charge per token', async () => {
    await listPlans(PASSES, false);
    const created = await addAccount().expect(201);

    await changeAccount(created.body.id, { planChoice: 'none' }).expect(400);
  });

  it('accepts only Auto where the Provider lists no Plans', async () => {
    await addAccount({ planChoice: 'Agent Pass' }).expect(400);
  });
});
