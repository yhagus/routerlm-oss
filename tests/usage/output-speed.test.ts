import { randomUUID } from 'node:crypto';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { usageLogs } from '@/db/schemas';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';

const ADA = { email: 'ada@example.com', password: "ada's password" };
const CREATED_AT = new Date('2026-11-02T10:00:00Z');

type NewUsageLog = typeof usageLogs.$inferInsert;

const ACME_LARGE = { upstreamModelId: randomUUID(), upstreamModelName: 'acme-large-2026' };
const ACME_SMALL = { upstreamModelId: randomUUID(), upstreamModelName: 'acme-small-2026' };
const TEAM_ACCOUNT = { providerAccountId: randomUUID(), providerAccountName: 'Team account' };

const STREAMED_ANSWER: NewUsageLog = {
  createdAt: CREATED_AT,
  clientProtocol: 'openai-chat',
  isStreamed: true,
  httpStatus: 200,
  inputTokens: 100,
  requestBytes: 500,
  responseBytes: 800,
  attemptCount: 1,
  ...ACME_LARGE,
  ...TEAM_ACCOUNT,
  timeToFirstTokenMs: 1000,
  durationMs: 2000,
  outputTokens: 101,
};

describe('Usage API: Output Speed (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table usage_logs cascade`);
    await deleteAllUsers(app);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  async function summary() {
    const response = await request(app.getHttpServer())
      .get('/api/usage/totals')
      .set('Cookie', adaCookie)
      .expect(200);
    return response.body;
  }

  it('reports Output Speed p50 and p5, overall and per Upstream Model and Provider Account', async () => {
    await db.insert(usageLogs).values([
      { ...STREAMED_ANSWER, outputTokens: 101 },
      { ...STREAMED_ANSWER, outputTokens: 201 },
      {
        ...STREAMED_ANSWER,
        outputTokens: 301,
        createdAt: new Date('2026-11-03T10:00:00Z'),
        providerAccountName: 'Renamed team account',
      },
      { ...STREAMED_ANSWER, ...ACME_SMALL, outputTokens: 401 },
    ]);

    expect(await summary()).toMatchObject({
      outputSpeedP50: 250,
      outputSpeedP5: expect.closeTo(115),
      outputSpeedByUpstream: expect.arrayContaining([
        {
          ...ACME_LARGE,
          providerAccountId: TEAM_ACCOUNT.providerAccountId,
          providerAccountName: 'Renamed team account',
          outputSpeedP50: 200,
          outputSpeedP5: expect.closeTo(110),
        },
        {
          ...ACME_SMALL,
          ...TEAM_ACCOUNT,
          outputSpeedP50: 400,
          outputSpeedP5: 400,
        },
      ]),
    });
  });

  it('measures answer tokens only when the reasoning was hidden, and every token when it was streamed', async () => {
    await db.insert(usageLogs).values([
      { ...STREAMED_ANSWER, outputTokens: 301, reasoningTokens: 200, isReasoningStreamed: false },
      {
        ...STREAMED_ANSWER,
        ...ACME_SMALL,
        outputTokens: 301,
        reasoningTokens: 200,
        isReasoningStreamed: true,
      },
    ]);

    const { outputSpeedByUpstream } = await summary();

    expect(outputSpeedByUpstream).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ...ACME_LARGE, outputSpeedP50: 100 }),
        expect.objectContaining({ ...ACME_SMALL, outputSpeedP50: 300 }),
      ]),
    );
  });

  it('leaves out requests that are not streamed, failed, cancelled, incomplete or too short to measure', async () => {
    const fast = { ...STREAMED_ANSWER, outputTokens: 1001 };
    await db.insert(usageLogs).values([
      { ...STREAMED_ANSWER, outputTokens: 101 },
      { ...fast, isStreamed: false },
      { ...fast, httpStatus: 502, errorCode: 'upstream_error' },
      { ...fast, isCancelled: true },
      { ...fast, isIncomplete: true },
      { ...STREAMED_ANSWER, outputTokens: 31, durationMs: 1001 },
    ]);

    expect(await summary()).toMatchObject({
      outputSpeedP50: 100,
      outputSpeedP5: 100,
      outputSpeedByUpstream: [expect.objectContaining({ outputSpeedP50: 100, outputSpeedP5: 100 })],
    });
  });
});
