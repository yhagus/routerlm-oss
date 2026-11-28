import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { apiKeys } from '@/db/schemas';
import { authenticateWithApiKey, createApiKey } from '@tests/support/api-keys';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';
import { truncateTables } from '@tests/support/truncate';

const ADA = { email: 'ada@example.com', password: "ada's password" };

describe('Copying an API Key (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await truncateTables(app, sql.raw('api_keys, models'));
    await deleteAllUsers(app);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  it('shows the same key that creating it returned, and that key signs a client in', async () => {
    const created = await createApiKey(app, adaCookie);

    const copied = await request(app.getHttpServer())
      .get(`/api/api-keys/${created.id}/key`)
      .set('Cookie', adaCookie)
      .expect(200);

    expect(copied.body).toEqual({ key: created.key });
    await expect(authenticateWithApiKey(app, copied.body.key)).resolves.toMatchObject({
      user: { apiKeyId: created.id },
    });
  });

  it('refuses to show a revoked key, and lists it as not copyable', async () => {
    const created = await createApiKey(app, adaCookie);
    await request(app.getHttpServer())
      .post(`/api/api-keys/${created.id}/revoke`)
      .set('Cookie', adaCookie)
      .expect(204);

    const copied = await request(app.getHttpServer())
      .get(`/api/api-keys/${created.id}/key`)
      .set('Cookie', adaCookie)
      .expect(409);
    const list = await request(app.getHttpServer())
      .get('/api/api-keys')
      .set('Cookie', adaCookie)
      .expect(200);

    expect(copied.body.message).toBe("A revoked API Key can't be shown.");
    expect(list.body).toMatchObject([{ id: created.id, isCopyable: false }]);
  });

  it('refuses to show a key created before keys were kept', async () => {
    const created = await createApiKey(app, adaCookie);
    await db.update(apiKeys).set({ encryptedKey: null }).where(eq(apiKeys.id, created.id));

    const copied = await request(app.getHttpServer())
      .get(`/api/api-keys/${created.id}/key`)
      .set('Cookie', adaCookie)
      .expect(409);

    expect(copied.body.message).toMatch(/^This API Key can't be shown again/);
  });

  it('answers 404 for a key that does not exist', async () => {
    await request(app.getHttpServer())
      .get('/api/api-keys/00000000-0000-4000-8000-000000000000/key')
      .set('Cookie', adaCookie)
      .expect(404);
  });
});
