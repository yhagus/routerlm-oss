import type { NestNodeApplication } from '@nestjs/platform-node';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import {
  apiKeys,
  attempts,
  errorCaptures,
  models,
  providerAccounts,
  providers,
  usageLogs,
} from '@/db/schemas';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';
import { truncateTables } from '@tests/support/truncate';

const ADA = { email: 'ada@example.com', password: "ada's password" };
const RECEIVED_AT = new Date('2026-11-10T10:00:00Z');

describe('Error Captures API (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;
  let usageLogId: string;
  let attemptId: string;
  let providerAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await truncateTables(db, sql.raw('usage_logs, api_keys, models, providers'));
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
    const [{ id: modelId }] = await db
      .insert(models)
      .values({ name: 'smart' })
      .returning({ id: models.id });
    const [{ id: apiKeyId }] = await db
      .insert(apiKeys)
      .values({ name: 'CI', keyId: 'ci', hash: 'hash-ci' })
      .returning({ id: apiKeys.id });
    const [{ id: providerId }] = await db
      .insert(providers)
      .values({
        slug: 'acme',
        name: 'Acme',
        endpoints: [{ kind: 'chat', protocol: 'openai-chat', baseUrl: 'https://acme.test/v1' }],
        authStyle: 'bearer',
      })
      .returning({ id: providers.id });
    [{ id: providerAccountId }] = await db
      .insert(providerAccounts)
      .values({ providerId, name: 'Acme main', encryptedKey: 'v1.x.y.z', keyLastFour: '1234' })
      .returning({ id: providerAccounts.id });
    [{ id: usageLogId }] = await db
      .insert(usageLogs)
      .values({
        createdAt: RECEIVED_AT,
        apiKeyId,
        apiKeyName: 'CI',
        modelId,
        modelName: 'smart',
        clientProtocol: 'openai-chat',
        isStreamed: false,
        httpStatus: 502,
        errorCode: 'upstream_error',
        requestBytes: 20,
        responseBytes: 80,
        durationMs: 300,
        attemptCount: 1,
      })
      .returning({ id: usageLogs.id });
    [{ id: attemptId }] = await db
      .insert(attempts)
      .values({
        usageLogId,
        startedAt: RECEIVED_AT,
        providerSlug: 'acme',
        providerName: 'Acme',
        providerAccountId,
        providerAccountName: 'Acme main',
        upstreamStatus: 500,
        failureReason: 'server_error',
        upstreamRequestId: 'req_acme_42',
        durationMs: 250,
      })
      .returning({ id: attempts.id });
  });

  afterAll(async () => {
    await app.close();
  });

  function getCaptures(path: string, cookie = adaCookie) {
    return request(app.getHttpServer()).get(`/api/error-captures${path}`).set('Cookie', cookie);
  }

  it("lists a Usage Log's captures newest first, naming what failed", async () => {
    await db.insert(errorCaptures).values([
      {
        usageLogId,
        attemptId,
        createdAt: new Date('2026-11-10T10:00:01Z'),
        requestHeaders: {},
        requestBody: '{}',
        responseHeaders: {},
        responseBody: 'down',
        userAgent: 'OpenAI/Python 1.54.0',
        clientIp: '203.0.113.7',
      },
      {
        usageLogId,
        createdAt: new Date('2026-11-10T10:00:00Z'),
        requestHeaders: {},
        requestBody: '{}',
      },
    ]);

    const response = await getCaptures(`?usageLogId=${usageLogId}`).expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items).toEqual([
      expect.objectContaining({
        usageLogId,
        modelName: 'smart',
        apiKeyName: 'CI',
        httpStatus: 502,
        errorCode: 'upstream_error',
        userAgent: 'OpenAI/Python 1.54.0',
        clientIp: '203.0.113.7',
        failedHop: {
          kind: 'gateway-to-provider-account',
          attemptId,
          providerAccountId,
          providerAccountName: 'Acme main',
          providerName: 'Acme',
          upstreamStatus: 500,
          failureReason: 'server_error',
          upstreamRequestId: 'req_acme_42',
        },
      }),
      expect.objectContaining({ failedHop: { kind: 'client-to-gateway' } }),
    ]);
    expect(response.body.items[0]).not.toHaveProperty('requestBody');
  });

  it('shows one capture with its headers and bodies, and 404 for an unknown one', async () => {
    const [{ id }] = await db
      .insert(errorCaptures)
      .values({
        usageLogId,
        attemptId,
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: '{"model":"smart"}',
        responseHeaders: { 'retry-after': '5' },
        responseBody: '{"error":"down"}',
      })
      .returning({ id: errorCaptures.id });

    const response = await getCaptures(`/${id}`).expect(200);
    await getCaptures('/00000000-0000-4000-8000-000000000000').expect(404);

    expect(response.body).toMatchObject({
      id,
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: '{"model":"smart"}',
      responseHeaders: { 'retry-after': '5' },
      responseBody: '{"error":"down"}',
      failedHop: expect.objectContaining({ kind: 'gateway-to-provider-account' }),
    });
  });

  it('searches Model names, API Key names and error codes, alongside the Usage Log filter', async () => {
    const [{ id: fastId }] = await db
      .insert(models)
      .values({ name: 'fast' })
      .returning({ id: models.id });
    const [{ id: laptopKeyId }] = await db
      .insert(apiKeys)
      .values({ name: 'Laptop', keyId: 'laptop', hash: 'hash-laptop' })
      .returning({ id: apiKeys.id });
    const [{ id: timedOutLogId }] = await db
      .insert(usageLogs)
      .values({
        createdAt: RECEIVED_AT,
        apiKeyId: laptopKeyId,
        apiKeyName: 'Laptop',
        modelId: fastId,
        modelName: 'fast',
        clientProtocol: 'openai-chat',
        isStreamed: false,
        httpStatus: 504,
        errorCode: 'upstream_timeout',
        requestBytes: 20,
        responseBytes: 0,
        durationMs: 30000,
        attemptCount: 1,
      })
      .returning({ id: usageLogs.id });
    await db.insert(errorCaptures).values([
      { usageLogId, requestHeaders: {}, requestBody: '{}' },
      { usageLogId: timedOutLogId, requestHeaders: {}, requestBody: '{}' },
    ]);

    const byModel = await getCaptures('?q=SMART').expect(200);
    const byApiKey = await getCaptures('?q=laptop').expect(200);
    const byErrorCode = await getCaptures('?q=Timeout').expect(200);
    const withOtherLog = await getCaptures(`?q=smart&usageLogId=${timedOutLogId}`).expect(200);

    expect(byModel.body.items).toEqual([expect.objectContaining({ usageLogId })]);
    expect(byApiKey.body.items).toEqual([
      expect.objectContaining({ usageLogId: timedOutLogId, apiKeyName: 'Laptop' }),
    ]);
    expect(byErrorCode.body.total).toBe(1);
    expect(byErrorCode.body.items).toEqual([
      expect.objectContaining({ errorCode: 'upstream_timeout' }),
    ]);
    expect(withOtherLog.body.total).toBe(0);
  });

  it('refuses requests without a signed-in User', async () => {
    await getCaptures('', '').expect(401);
  });
});
