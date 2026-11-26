import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts, quotaMeters } from '@/db/schemas';
import { addProviderAccount, UPSTREAM_KEY } from '@tests/support/inference';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const CHECKED_AT = new Date('2026-11-16T08:00:00Z');

const ACME = {
  slug: 'acme',
  name: 'Acme AI',
  endpoints: [{ kind: 'chat', protocol: 'openai-chat', baseUrl: 'https://api.acme.example/v1' }],
  authStyle: 'bearer',
  quotaReader: 'kimi-code',
};

describe("Changing a Provider's quota reader (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;
  let providerId: string;
  let providerAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    const created = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send(ACME)
      .expect(201);
    providerId = created.body.id;
    providerAccountId = await addProviderAccount(app, db, providerId, {
      key: UPSTREAM_KEY,
      priority: 0,
    });
    await recordReading(providerAccountId);
  });

  afterAll(async () => {
    await app.close();
  });

  async function recordReading(accountId: string): Promise<void> {
    await db.insert(quotaMeters).values({
      providerAccountId: accountId,
      key: 'weekly',
      label: 'Weekly',
      unit: 'percent',
      remainingPercent: 40,
      observedAt: CHECKED_AT,
      raw: {},
    });
    await db
      .update(providerAccounts)
      .set({ quotaCheckedAt: CHECKED_AT, quotaError: 'upstream returned 500' })
      .where(eq(providerAccounts.id, accountId));
  }

  function updateProvider(changes: object) {
    return request(app.getHttpServer())
      .patch(`/api/providers/${providerId}`)
      .set('Cookie', cookie)
      .send(changes)
      .expect(200);
  }

  async function readingOf(accountId: string) {
    const meters = await db
      .select({ key: quotaMeters.key })
      .from(quotaMeters)
      .where(eq(quotaMeters.providerAccountId, accountId));
    const [account] = await db
      .select({
        quotaCheckedAt: providerAccounts.quotaCheckedAt,
        quotaError: providerAccounts.quotaError,
      })
      .from(providerAccounts)
      .where(eq(providerAccounts.id, accountId));
    return { meters, ...account };
  }

  it("clears every reading of the Provider's accounts when the reader changes", async () => {
    await updateProvider({ quotaReader: 'minimax-m-plan' });

    expect(await readingOf(providerAccountId)).toEqual({
      meters: [],
      quotaCheckedAt: null,
      quotaError: null,
    });
  });

  it('clears them when the reader is removed', async () => {
    await updateProvider({ quotaReader: null });

    expect(await readingOf(providerAccountId)).toMatchObject({ meters: [], quotaCheckedAt: null });
  });

  it('keeps them when the reader stays the same', async () => {
    await updateProvider({ name: 'Acme', quotaReader: 'kimi-code' });

    expect(await readingOf(providerAccountId)).toEqual({
      meters: [{ key: 'weekly' }],
      quotaCheckedAt: CHECKED_AT,
      quotaError: 'upstream returned 500',
    });
  });
});
