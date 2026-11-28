import type { NestNodeApplication } from '@nestjs/platform-node';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { errorCaptures, usageLogs } from '@/db/schemas';
import { createIntegration } from '@tests/support/integrations';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';
import { truncateTables } from '@tests/support/truncate';

const ADA = { email: 'ada@example.com', password: "ada's password" };

describe("A deleted Integration's records (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await truncateTables(app, sql.raw('integrations, usage_logs'));
    await deleteAllUsers(app);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  async function recordFailedCustomerRequestThenDeleteIntegration(): Promise<{
    integrationId: string;
    usageLogId: string;
    captureId: string;
  }> {
    const integration = await createIntegration(app, adaCookie, { name: 'Acme SaaS' });
    const [{ id: usageLogId }] = await db
      .insert(usageLogs)
      .values({
        createdAt: new Date(),
        apiKeyName: 'customer key',
        integrationId: integration.id,
        integrationName: 'Acme SaaS',
        customerId: 'customer-42',
        clientProtocol: 'openai-chat',
        isStreamed: false,
        httpStatus: 502,
        errorCode: 'upstream_error',
        errorOrigin: 'upstream',
        requestBytes: 20,
        responseBytes: 80,
        durationMs: 300,
        attemptCount: 0,
      })
      .returning({ id: usageLogs.id });
    const [{ id: captureId }] = await db
      .insert(errorCaptures)
      .values({ usageLogId, createdAt: new Date(), requestHeaders: {}, requestBody: '{}' })
      .returning({ id: errorCaptures.id });
    await request(app.getHttpServer())
      .delete(`/api/integrations/${integration.id}`)
      .set('Cookie', adaCookie)
      .expect(204);
    return { integrationId: integration.id, usageLogId, captureId };
  }

  function get(path: string): request.Test {
    return request(app.getHttpServer()).get(path).set('Cookie', adaCookie).expect(200);
  }

  it('still shows its name and Customer id in the Usage Logs', async () => {
    const { integrationId, usageLogId } = await recordFailedCustomerRequestThenDeleteIntegration();
    const expected = { integrationId, integrationName: 'Acme SaaS', customerId: 'customer-42' };

    const list = await get('/api/usage');
    const detail = await get(`/api/usage/${usageLogId}`);

    expect(list.body.items).toEqual([expect.objectContaining(expected)]);
    expect(detail.body).toMatchObject(expected);
  });

  it('still shows its name and Customer id in the Error Captures', async () => {
    const { integrationId, captureId } = await recordFailedCustomerRequestThenDeleteIntegration();
    const expected = { integrationId, integrationName: 'Acme SaaS', customerId: 'customer-42' };

    const list = await get('/api/error-captures');
    const detail = await get(`/api/error-captures/${captureId}`);

    expect(list.body.items).toEqual([expect.objectContaining(expected)]);
    expect(detail.body).toMatchObject(expected);
  });
});
