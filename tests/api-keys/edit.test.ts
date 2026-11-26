import type { NestNodeApplication } from '@nestjs/platform-node';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { models } from '@/db/schemas';
import { authenticateWithApiKey, createApiKey } from '@tests/support/api-keys';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';

const ADA = { email: 'ada@example.com', password: "ada's password" };
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Editing an API Key (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table api_keys, models cascade`);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  it('changes the name, expiry and allowed Models, and signs the key in with the new restriction', async () => {
    const [model] = await db.insert(models).values({ name: 'smart' }).returning();
    const created = await createApiKey(app, adaCookie);

    const edited = await request(app.getHttpServer())
      .patch(`/api/api-keys/${created.id}`)
      .set('Cookie', adaCookie)
      .send({
        name: 'Nightly',
        expiresAt: '2999-01-01T00:00:00.000Z',
        allowedModelIds: [model.id],
      })
      .expect(200);

    expect(edited.body).toMatchObject({
      id: created.id,
      name: 'Nightly',
      expiresAt: '2999-01-01T00:00:00.000Z',
      allowedModels: [{ id: model.id, name: 'smart' }],
      isCopyable: true,
    });
    await expect(authenticateWithApiKey(app, created.key)).resolves.toMatchObject({
      user: { apiKeyName: 'Nightly', allowedModelIds: [model.id] },
    });
  });

  it('clears the expiry when sent null', async () => {
    const created = await createApiKey(app, adaCookie, {
      name: 'CI',
      expiresAt: '2999-01-01T00:00:00.000Z',
    });

    const edited = await request(app.getHttpServer())
      .patch(`/api/api-keys/${created.id}`)
      .set('Cookie', adaCookie)
      .send({ expiresAt: null })
      .expect(200);

    expect(edited.body).toMatchObject({ name: 'CI', expiresAt: null });
  });

  it('rejects an edit that changes nothing', async () => {
    const created = await createApiKey(app, adaCookie);

    await request(app.getHttpServer())
      .patch(`/api/api-keys/${created.id}`)
      .set('Cookie', adaCookie)
      .send({})
      .expect(400);
  });

  it('rejects an allowed Model that does not exist', async () => {
    const created = await createApiKey(app, adaCookie);

    await request(app.getHttpServer())
      .patch(`/api/api-keys/${created.id}`)
      .set('Cookie', adaCookie)
      .send({ allowedModelIds: [UNKNOWN_ID] })
      .expect(400);
  });

  it('rejects an allowed Model Group that does not exist', async () => {
    const created = await createApiKey(app, adaCookie);

    await request(app.getHttpServer())
      .patch(`/api/api-keys/${created.id}`)
      .set('Cookie', adaCookie)
      .send({ allowedModelGroupIds: [UNKNOWN_ID] })
      .expect(400);
  });

  it('refuses to change a revoked key', async () => {
    const created = await createApiKey(app, adaCookie);
    await request(app.getHttpServer())
      .post(`/api/api-keys/${created.id}/revoke`)
      .set('Cookie', adaCookie)
      .expect(204);

    const edited = await request(app.getHttpServer())
      .patch(`/api/api-keys/${created.id}`)
      .set('Cookie', adaCookie)
      .send({ name: 'Nightly' })
      .expect(409);

    expect(edited.body.message).toBe("A revoked API Key can't be changed.");
  });
});
