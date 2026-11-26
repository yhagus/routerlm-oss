import type { NestNodeApplication } from '@nestjs/platform-node';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { authenticateWithApiKey, createApiKey } from '@tests/support/api-keys';
import { createIntegration } from '@tests/support/integrations';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';

const ADA = { email: 'ada@example.com', password: "ada's password" };

describe('API Keys an Integration issued, in the dashboard API (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;
  let acme: { id: string; secret: string };

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table integrations, api_keys cascade`);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
    acme = await createIntegration(app, adaCookie, { name: 'Acme SaaS' });
  });

  afterAll(async () => {
    await app.close();
  });

  async function issueCustomerKey(
    integration: { secret: string },
    customerId: string,
  ): Promise<{ id: string; key: string }> {
    const created = await request(app.getHttpServer())
      .post('/integration/v1/keys')
      .set('Authorization', `Bearer ${integration.secret}`)
      .send({ customerId })
      .expect(201);
    return { id: created.body.apiKey.id, key: created.body.key };
  }

  function listApiKeys(query = '') {
    return request(app.getHttpServer())
      .get(`/api/api-keys${query}`)
      .set('Cookie', adaCookie)
      .expect(200);
  }

  it('shows which Integration and Customer own each key, and filters by both', async () => {
    const globex = await createIntegration(app, adaCookie, { name: 'Globex' });
    const acmeKey = await issueCustomerKey(acme, 'cus_1');
    await issueCustomerKey(acme, 'cus_2');
    await issueCustomerKey(globex, 'cus_1');
    const operatorKey = await createApiKey(app, adaCookie);

    const all = await listApiKeys();
    const acmeCustomer = await listApiKeys(`?integrationId=${acme.id}&customerId=cus_1`);

    expect(all.body).toHaveLength(4);
    expect(all.body).toContainEqual(
      expect.objectContaining({ id: operatorKey.id, integration: null, customerId: null }),
    );
    expect(acmeCustomer.body).toEqual([
      expect.objectContaining({
        id: acmeKey.id,
        integration: { id: acme.id, name: 'Acme SaaS' },
        customerId: 'cus_1',
        isCopyable: false,
      }),
    ]);
  });

  it("refuses to change or rotate an Integration's key, but revokes it", async () => {
    const customerKey = await issueCustomerKey(acme, 'cus_1');
    const server = app.getHttpServer();

    await request(server)
      .patch(`/api/api-keys/${customerKey.id}`)
      .set('Cookie', adaCookie)
      .send({ name: 'Taken over' })
      .expect(409);
    await request(server)
      .post(`/api/api-keys/${customerKey.id}/rotate`)
      .set('Cookie', adaCookie)
      .expect(409);
    await request(server)
      .post(`/api/api-keys/${customerKey.id}/revoke`)
      .set('Cookie', adaCookie)
      .expect(204);

    await expect(authenticateWithApiKey(app, customerKey.key)).rejects.toThrow();
  });
});
