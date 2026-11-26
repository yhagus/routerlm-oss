import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { FakeUpstream } from '@tests/support/fake-upstream';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { insertTokenHarbor } from '@tests/support/tokenharbor-plans';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const ACCOUNT_KEY = 'th-account-key-0123456789';

describe('Letting a Provider Account pay beyond its Plan (e2e)', () => {
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

  function addAccount(fields: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/provider-accounts')
      .set('Cookie', cookie)
      .send({ providerId, key: ACCOUNT_KEY, ...fields });
  }

  it('sets it when the account is added and changes it later', async () => {
    const created = await addAccount({ paysBeyondPlan: true }).expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/api/provider-accounts/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ paysBeyondPlan: false })
      .expect(200);

    expect([created.body.paysBeyondPlan, updated.body.paysBeyondPlan]).toEqual([true, false]);
  });

  it('refuses a Plan typed by the operator', async () => {
    await addAccount({ plan: 'Frontier Pass' }).expect(400);
  });
});
