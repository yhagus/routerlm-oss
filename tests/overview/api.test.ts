import type { NestNodeApplication } from '@nestjs/platform-node';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { usageLogs } from '@/db/schemas';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';

const ADA = { email: 'ada@example.com', password: "ada's password" };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type NewUsageLog = typeof usageLogs.$inferInsert;

const SERVED_REQUEST: Omit<NewUsageLog, 'createdAt'> = {
  clientProtocol: 'openai-chat',
  isStreamed: false,
  httpStatus: 200,
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 300,
  cacheWriteTokens: 100,
  requestBytes: 500,
  responseBytes: 800,
  cost: 0.25,
  durationMs: 900,
  attemptCount: 1,
};

const FAILED_REQUEST: Omit<NewUsageLog, 'createdAt'> = {
  ...SERVED_REQUEST,
  httpStatus: 502,
  errorCode: 'upstream_error',
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  cost: null,
};

const NO_ERRORS_BY_ORIGIN = {
  client: { count: 0, rate: null },
  upstream: { count: 0, rate: null },
  gateway: { count: 0, rate: null },
};

function currentBucketStart(sizeMs: number): number {
  return Math.floor(Date.now() / sizeMs) * sizeMs;
}

describe('Overview API (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table usage_logs cascade`);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  function getOverview(range: string) {
    return request(app.getHttpServer())
      .get(`/api/overview?range=${range}`)
      .set('Cookie', adaCookie);
  }

  it('charts requests, Cost, cache hit rate and error rate per hour over the last 24 hours', async () => {
    const currentHour = currentBucketStart(HOUR_MS);
    const threeHoursAgo = currentHour - 3 * HOUR_MS;
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt: new Date(threeHoursAgo + 10 * MINUTE_MS) },
      { ...FAILED_REQUEST, createdAt: new Date(threeHoursAgo + 20 * MINUTE_MS) },
      { ...SERVED_REQUEST, createdAt: new Date(currentHour) },
      { ...SERVED_REQUEST, createdAt: new Date(currentHour - 2 * DAY_MS) },
    ]);

    const response = await getOverview('24h').expect(200);

    expect(response.body.hasUsageLogs).toBe(true);
    expect(response.body.bucketSeconds).toBe(3600);
    expect(response.body.buckets).toHaveLength(24);
    expect(response.body.buckets[0]).toEqual({
      start: new Date(currentHour - 23 * HOUR_MS).toISOString(),
      requestCount: 0,
      cost: 0,
      cacheHitRate: null,
      errorRate: null,
      failedCount: 0,
      errorsByOrigin: NO_ERRORS_BY_ORIGIN,
    });
    expect(response.body.buckets[20]).toMatchObject({
      start: new Date(threeHoursAgo).toISOString(),
      requestCount: 2,
      cost: 0.25,
      cacheHitRate: 0.6,
      errorRate: 0.5,
    });
    expect(response.body.buckets[23]).toMatchObject({ requestCount: 1, errorRate: 0 });
    expect(response.body.totals).toMatchObject({
      requestCount: 3,
      cost: 0.5,
      cacheHitRate: 0.6,
      errorRate: 1 / 3,
    });
  });

  it('counts failed requests, origin or not, and splits them by Error Origin per bucket and in the totals', async () => {
    const currentHour = currentBucketStart(HOUR_MS);
    const twoHoursAgo = currentHour - 2 * HOUR_MS;
    await db.insert(usageLogs).values([
      { ...FAILED_REQUEST, errorOrigin: 'client', createdAt: new Date(twoHoursAgo) },
      { ...FAILED_REQUEST, errorOrigin: 'upstream', createdAt: new Date(twoHoursAgo) },
      { ...FAILED_REQUEST, errorOrigin: 'upstream', createdAt: new Date(twoHoursAgo) },
      { ...FAILED_REQUEST, errorOrigin: null, createdAt: new Date(twoHoursAgo) },
      { ...SERVED_REQUEST, createdAt: new Date(currentHour) },
      { ...FAILED_REQUEST, errorOrigin: 'gateway', createdAt: new Date(currentHour) },
    ]);

    const response = await getOverview('24h').expect(200);

    expect(response.body.buckets[0].errorsByOrigin).toEqual(NO_ERRORS_BY_ORIGIN);
    expect(response.body.buckets[21]).toMatchObject({
      requestCount: 4,
      errorRate: 1,
      failedCount: 4,
      errorsByOrigin: {
        client: { count: 1, rate: 0.25 },
        upstream: { count: 2, rate: 0.5 },
        gateway: { count: 0, rate: 0 },
      },
    });
    expect(response.body.buckets[23].failedCount).toBe(1);
    expect(response.body.buckets[23].errorsByOrigin).toEqual({
      client: { count: 0, rate: 0 },
      upstream: { count: 0, rate: 0 },
      gateway: { count: 1, rate: 0.5 },
    });
    expect(response.body.totals).toMatchObject({
      requestCount: 6,
      errorRate: 5 / 6,
      failedCount: 5,
      errorsByOrigin: {
        client: { count: 1, rate: 1 / 6 },
        upstream: { count: 2, rate: 2 / 6 },
        gateway: { count: 1, rate: 1 / 6 },
      },
    });
  });

  it('charts six-hour buckets over 7 days and daily buckets over 30 days', async () => {
    const currentDay = currentBucketStart(DAY_MS);
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt: new Date(currentDay - 2 * DAY_MS) },
      { ...SERVED_REQUEST, createdAt: new Date(currentDay - 20 * DAY_MS) },
    ]);

    const week = await getOverview('7d').expect(200);
    const month = await getOverview('30d').expect(200);

    expect(week.body.buckets).toHaveLength(28);
    expect(week.body.totals.requestCount).toBe(1);
    expect(month.body.buckets).toHaveLength(30);
    expect(month.body.buckets[27]).toMatchObject({
      start: new Date(currentDay - 2 * DAY_MS).toISOString(),
      requestCount: 1,
    });
    expect(month.body.totals.requestCount).toBe(2);
  });

  it('tells an empty database apart from a range with no requests', async () => {
    const empty = await getOverview('24h').expect(200);
    await db
      .insert(usageLogs)
      .values({ ...SERVED_REQUEST, createdAt: new Date(Date.now() - 40 * DAY_MS) });
    const quiet = await getOverview('24h').expect(200);

    expect(empty.body.hasUsageLogs).toBe(false);
    expect(quiet.body.hasUsageLogs).toBe(true);
    expect(quiet.body.totals).toEqual({
      requestCount: 0,
      cost: 0,
      cacheHitRate: null,
      errorRate: null,
      failedCount: 0,
      errorsByOrigin: NO_ERRORS_BY_ORIGIN,
    });
  });

  it('refuses a range it does not offer', async () => {
    await getOverview('1y').expect(400);
  });

  it('is only for signed-in Users', async () => {
    await request(app.getHttpServer()).get('/api/overview?range=24h').expect(401);
  });
});
