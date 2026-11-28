import { randomUUID } from 'node:crypto';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { attempts, usageLogs } from '@/db/schemas';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';
import { truncateTables } from '@tests/support/truncate';

const ADA = { email: 'ada@example.com', password: "ada's password" };

type NewAttempt = typeof attempts.$inferInsert;

const FALLEN_BACK_REQUEST: typeof usageLogs.$inferInsert = {
  createdAt: new Date('2026-11-02T10:00:00Z'),
  modelName: 'smart',
  clientProtocol: 'openai-chat',
  isStreamed: false,
  httpStatus: 502,
  errorCode: 'upstream_error',
  errorOrigin: 'upstream',
  userAgent: 'OpenAI/Python 1.54.0',
  clientIp: '203.0.113.7',
  requestBytes: 500,
  responseBytes: 120,
  durationMs: 2400,
  attemptCount: 2,
};

const ATTEMPT: Omit<NewAttempt, 'usageLogId' | 'startedAt'> = {
  modelName: 'smart',
  upstreamModelName: 'gpt-5',
  providerSlug: 'openai',
  providerName: 'OpenAI',
  providerAccountName: 'Team account',
  durationMs: 1200,
};

describe('Usage API: one Usage Log with its Attempts (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await truncateTables(db, sql.raw('usage_logs'));
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  function getUsage(path: string) {
    return request(app.getHttpServer()).get(`/api/usage${path}`).set('Cookie', adaCookie);
  }

  it('shows the Usage Log with who sent it and its Attempts in the order they ran', async () => {
    const [{ id }] = await db
      .insert(usageLogs)
      .values(FALLEN_BACK_REQUEST)
      .returning({ id: usageLogs.id });
    await db.insert(attempts).values([
      {
        ...ATTEMPT,
        usageLogId: id,
        startedAt: new Date('2026-11-02T10:00:01Z'),
        upstreamStatus: 502,
        failureReason: 'server_error',
        upstreamRequestId: 'req_second',
      },
      {
        ...ATTEMPT,
        usageLogId: id,
        startedAt: new Date('2026-11-02T10:00:00Z'),
        upstreamStatus: 429,
        failureReason: 'rate_limited',
        upstreamRequestId: 'req_first',
      },
    ]);

    const response = await getUsage(`/${id}`).expect(200);

    expect(response.body).toMatchObject({
      id,
      httpStatus: 502,
      errorCode: 'upstream_error',
      errorOrigin: 'upstream',
      userAgent: 'OpenAI/Python 1.54.0',
      clientIp: '203.0.113.7',
      attempts: [
        {
          startedAt: '2026-11-02T10:00:00.000Z',
          upstreamModelName: 'gpt-5',
          providerName: 'OpenAI',
          providerAccountName: 'Team account',
          upstreamStatus: 429,
          failureReason: 'rate_limited',
          upstreamRequestId: 'req_first',
          durationMs: 1200,
        },
        {
          startedAt: '2026-11-02T10:00:01.000Z',
          upstreamStatus: 502,
          failureReason: 'server_error',
          upstreamRequestId: 'req_second',
        },
      ],
    });
  });

  it('answers 404 for a Usage Log that does not exist', async () => {
    await getUsage(`/${randomUUID()}`).expect(404);
  });

  it('is only for signed-in Users', async () => {
    await request(app.getHttpServer()).get(`/api/usage/${randomUUID()}`).expect(401);
  });
});
