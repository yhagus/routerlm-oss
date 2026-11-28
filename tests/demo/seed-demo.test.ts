import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { and, count, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import request from 'supertest';
import { type Database, relations } from '@/db/schemas/relations';
import { attempts, usageLogs } from '@/db/schemas';
import { createEmptyDatabase, dropDatabase } from '@tests/support/isolated-database';
import { MIGRATIONS_FOLDER } from '@tests/support/migrations';
import { createTestApp, sessionCookieOf } from '@tests/support/test-app';

const runFile = promisify(execFile);
const SEED_TIMEOUT_MS = 60_000;

const DEMO_CREDENTIALS = { email: 'admin@example.com', password: 'routerlm-demo' };
const DEMO_REQUEST_COUNT = 1_750;

describe('db:seed:demo script (e2e)', () => {
  const serverUrl = process.env.DATABASE_URL ?? '';
  let databaseUrl: string;
  let pool: Pool;
  let db: Database;
  let app: NestNodeApplication | undefined;

  function seedDemo(targetUrl: string) {
    return runFile('bun', ['src/seed-demo.ts'], {
      env: { ...process.env, DATABASE_URL: targetUrl },
      timeout: SEED_TIMEOUT_MS,
    });
  }

  beforeAll(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, 'seed', '_demo');
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle({ client: pool, relations });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (databaseUrl) await dropDatabase(serverUrl, databaseUrl);
  });

  it("refuses a database whose name doesn't end in _demo", async () => {
    await expect(seedDemo(serverUrl)).rejects.toMatchObject({
      stderr: expect.stringContaining('must end in _demo'),
    });
  });

  it(
    'fills the demo database once, however often it runs',
    async () => {
      await seedDemo(databaseUrl);
      await seedDemo(databaseUrl);

      const [{ usageLogCount }] = await db.select({ usageLogCount: count() }).from(usageLogs);
      expect(usageLogCount).toBe(DEMO_REQUEST_COUNT);
    },
    2 * SEED_TIMEOUT_MS,
  );

  it('copies what served each request onto its Usage Log and Attempts', async () => {
    const servedWithoutSnapshot = await db
      .select({ id: usageLogs.id })
      .from(usageLogs)
      .where(
        and(
          eq(usageLogs.httpStatus, 200),
          or(
            isNull(usageLogs.modelName),
            isNull(usageLogs.upstreamModelId),
            isNull(usageLogs.upstreamModelName),
            isNull(usageLogs.providerSlug),
            isNull(usageLogs.providerAccountName),
          ),
        ),
      );
    const clientRequestsWithoutKeyName = await db
      .select({ id: usageLogs.id })
      .from(usageLogs)
      .where(and(isNotNull(usageLogs.apiKeyId), isNull(usageLogs.apiKeyName)));
    const attemptsWithoutSnapshot = await db
      .select({ id: attempts.id })
      .from(attempts)
      .where(
        or(
          isNull(attempts.modelName),
          isNull(attempts.upstreamModelId),
          isNull(attempts.upstreamModelName),
          isNull(attempts.providerSlug),
          isNull(attempts.providerAccountName),
        ),
      );

    expect(servedWithoutSnapshot).toEqual([]);
    expect(clientRequestsWithoutKeyName).toEqual([]);
    expect(attemptsWithoutSnapshot).toEqual([]);
  });

  it('signs the demo User in to an Overview with a week of traffic', async () => {
    ({ app } = await createTestApp(db));
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(DEMO_CREDENTIALS)
      .expect(200);

    const overview = await request(app.getHttpServer())
      .get('/api/overview?range=7d')
      .set('Cookie', sessionCookieOf(login))
      .expect(200);

    expect(overview.body.totals.requestCount).toBeGreaterThan(DEMO_REQUEST_COUNT * 0.9);
    expect(overview.body.totals.cost).toBeGreaterThan(0);
    expect(overview.body.totals.errorRate).toBeGreaterThan(0);
    expect(overview.body.totals.errorRate).toBeLessThan(0.05);
    expect(overview.body.totals.errorsByOrigin.upstream.count).toBe(
      overview.body.totals.failedCount,
    );
  });

  it('records who sent each demo request', async () => {
    const [{ withoutSender }] = await db
      .select({ withoutSender: count() })
      .from(usageLogs)
      .where(or(isNull(usageLogs.userAgent), isNull(usageLogs.clientIp)));

    expect(withoutSender).toBe(0);
  });

  it('records how each served demo request finished, its tools and its streamed reasoning', async () => {
    const [{ servedWithoutFinishReason }] = await db
      .select({ servedWithoutFinishReason: count() })
      .from(usageLogs)
      .where(and(eq(usageLogs.httpStatus, 200), isNull(usageLogs.finishReason)));
    const [{ withToolCalls }] = await db
      .select({ withToolCalls: count() })
      .from(usageLogs)
      .where(and(gt(usageLogs.toolCallCount, 0), eq(usageLogs.finishReason, 'tool_calls')));
    const [{ withStreamedReasoning }] = await db
      .select({ withStreamedReasoning: count() })
      .from(usageLogs)
      .where(eq(usageLogs.isReasoningStreamed, true));

    expect(servedWithoutFinishReason).toBe(0);
    expect(withToolCalls).toBeGreaterThan(0);
    expect(withStreamedReasoning).toBeGreaterThan(0);
  });
});
