import type { NestNodeApplication } from '@nestjs/platform-node';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { vi } from 'vitest';
import type { Database } from '@/db/schemas/relations';
import { models } from '@/db/schemas';
import { authenticateWithApiKey, createApiKey } from '@tests/support/api-keys';
import type { ControlPlaneClient } from '@tests/support/control-plane-client';
import { createIntegration } from '@tests/support/integrations';
import { insertModelGroup } from '@tests/support/model-groups';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';

const ADA = { email: 'ada@example.com', password: "ada's password" };
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const NEXT_YEAR = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
const SNAPSHOT_NOTICE_TIMEOUT_MS = 5_000;

const eventually = (assertion: () => Promise<unknown>): Promise<unknown> =>
  vi.waitFor(assertion, { timeout: SNAPSHOT_NOTICE_TIMEOUT_MS });

export interface ControlPlaneTransport {
  name: string;
  connect(
    app: NestNodeApplication,
  ): Promise<{ client: ControlPlaneClient; close: () => Promise<void> }>;
}

export function describeKeyScenarios(transport: ControlPlaneTransport): void {
  describe(`Control plane API Keys over ${transport.name} (e2e)`, () => {
    let app: NestNodeApplication;
    let db: Database;
    let client: ControlPlaneClient;
    let closeClient: () => Promise<void>;
    let adaCookie: string;
    let acme: { id: string; secret: string };

    beforeAll(async () => {
      ({ app, db } = await createTestApp());
      ({ client, close: closeClient } = await transport.connect(app));
    });

    beforeEach(async () => {
      await db.execute(sql`truncate table integrations, api_keys, models, model_groups cascade`);
      await deleteAllUsers(db);
      adaCookie = await setUpFirstUser(app, ADA);
      acme = await createIntegration(app, adaCookie, { name: 'Acme SaaS' });
    });

    afterAll(async () => {
      await closeClient();
      await app.close();
    });

    async function grantIntegrationDirectUpstreamAccess(): Promise<void> {
      await request(app.getHttpServer())
        .patch(`/api/integrations/${acme.id}`)
        .set('Cookie', adaCookie)
        .send({ directUpstreamAccess: true })
        .expect(200);
    }

    async function issueKey(customerId: string, settings: object = {}) {
      const created = await client.createKey(acme.secret, { customerId, ...settings });
      if (!created.ok) throw new Error(`createKey failed with ${created.code}`);
      return created.body;
    }

    describe('authentication', () => {
      it('refuses a call without an Integration Secret', async () => {
        await expect(client.createKey(undefined, { customerId: 'cus_1' })).resolves.toEqual({
          ok: false,
          code: 'UNAUTHENTICATED',
        });
      });

      it('refuses a wrong Integration Secret', async () => {
        const wrongSecret = `${acme.secret.slice(0, -4)}xxxx`;

        await expect(client.createKey(wrongSecret, { customerId: 'cus_1' })).resolves.toEqual({
          ok: false,
          code: 'UNAUTHENTICATED',
        });
      });

      it('refuses a secret rotated away, and accepts its replacement', async () => {
        const rotated = await request(app.getHttpServer())
          .post(`/api/integrations/${acme.id}/rotate`)
          .set('Cookie', adaCookie)
          .expect(201);

        await expect(client.listKeys(acme.secret)).resolves.toEqual({
          ok: false,
          code: 'UNAUTHENTICATED',
        });
        await expect(client.listKeys(rotated.body.secret)).resolves.toMatchObject({ ok: true });
      });

      it('refuses the secret of a disabled Integration', async () => {
        await request(app.getHttpServer())
          .post(`/api/integrations/${acme.id}/disable`)
          .set('Cookie', adaCookie)
          .expect(204);

        await expect(client.listKeys(acme.secret)).resolves.toEqual({
          ok: false,
          code: 'UNAUTHENTICATED',
        });
      });

      it('refuses an API Key in place of the Integration Secret', async () => {
        const operatorKey = await createApiKey(app, adaCookie);

        await expect(client.listKeys(operatorKey.key)).resolves.toEqual({
          ok: false,
          code: 'UNAUTHENTICATED',
        });
      });
    });

    describe('creating a key', () => {
      it('issues a key to a Customer with its settings, returning the whole key only then', async () => {
        const [model] = await db.insert(models).values({ name: 'smart' }).returning();

        const created = await client.createKey(acme.secret, {
          customerId: 'cus_42',
          name: 'Production',
          expiresAt: NEXT_YEAR,
          allowedModelIds: [model.id],
          spendLimit: 25.5,
          requestRate: 60,
        });
        if (!created.ok) throw new Error(`createKey failed with ${created.code}`);
        const fetched = await client.getKey(acme.secret, created.body.apiKey.id);

        expect(created.body.key).toMatch(/^rlm_[0-9a-f]{16}_\S+$/);
        expect(created.body.apiKey).toEqual({
          id: expect.any(String),
          keyId: created.body.key.split('_')[1],
          name: 'Production',
          customerId: 'cus_42',
          createdAt: expect.any(String),
          expiresAt: NEXT_YEAR,
          allowedModelIds: [model.id],
          directUpstreamAccess: false,
          spendLimit: 25.5,
          spent: 0,
          requestRate: 60,
        });
        expect(fetched).toEqual({ ok: true, body: created.body.apiKey });
        await eventually(() =>
          expect(authenticateWithApiKey(app, created.body.key)).resolves.toMatchObject({
            user: { apiKeyId: created.body.apiKey.id },
          }),
        );
      });

      it('names a key after its Customer when no name is given, with no limits', async () => {
        const issued = await issueKey('cus_7');

        expect(issued.apiKey).toMatchObject({ name: 'cus_7', allowedModelIds: [], spent: 0 });
        expect(issued.apiKey).not.toHaveProperty('spendLimit');
        expect(issued.apiKey).not.toHaveProperty('requestRate');
        expect(issued.apiKey).not.toHaveProperty('expiresAt');
      });

      it('refuses a key without a Customer id', async () => {
        await expect(client.createKey(acme.secret, { name: 'Orphan' })).resolves.toEqual({
          ok: false,
          code: 'INVALID_ARGUMENT',
        });
      });

      it("refuses allowed Models outside the Integration's, and accepts those within", async () => {
        const [sold, kept] = await db
          .insert(models)
          .values([{ name: 'sold' }, { name: 'kept' }])
          .returning();
        await request(app.getHttpServer())
          .patch(`/api/integrations/${acme.id}`)
          .set('Cookie', adaCookie)
          .send({ allowedModelIds: [sold.id] })
          .expect(200);

        await expect(
          client.createKey(acme.secret, { customerId: 'cus_1', allowedModelIds: [kept.id] }),
        ).resolves.toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
        await expect(
          client.createKey(acme.secret, { customerId: 'cus_1', allowedModelIds: [sold.id] }),
        ).resolves.toMatchObject({ ok: true });
      });

      it("counts the Models in the Integration's allowed Model Groups as within its Models", async () => {
        const [grouped, listed, outside] = await db
          .insert(models)
          .values([{ name: 'grouped' }, { name: 'listed' }, { name: 'outside' }])
          .returning();
        const fastGroupId = await insertModelGroup(app, db, 'fast', [grouped.id]);
        await request(app.getHttpServer())
          .patch(`/api/integrations/${acme.id}`)
          .set('Cookie', adaCookie)
          .send({ allowedModelIds: [listed.id], allowedModelGroupIds: [fastGroupId] })
          .expect(200);

        await expect(
          client.createKey(acme.secret, { customerId: 'cus_1', allowedModelIds: [outside.id] }),
        ).resolves.toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
        await expect(
          client.createKey(acme.secret, {
            customerId: 'cus_1',
            allowedModelIds: [grouped.id, listed.id],
          }),
        ).resolves.toMatchObject({ ok: true });
      });
    });

    describe('Direct Upstream Access', () => {
      it("refuses it to a key while the Integration doesn't have it", async () => {
        await expect(
          client.createKey(acme.secret, { customerId: 'cus_1', directUpstreamAccess: true }),
        ).resolves.toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
        const issued = await issueKey('cus_1');
        await expect(
          client.updateKey(acme.secret, issued.apiKey.id, { directUpstreamAccess: true }),
        ).resolves.toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
      });

      it('grants it to a key once the Integration has it, and withdraws it again', async () => {
        await grantIntegrationDirectUpstreamAccess();

        const issued = await issueKey('cus_1', { directUpstreamAccess: true });
        const withdrawn = await client.updateKey(acme.secret, issued.apiKey.id, {
          directUpstreamAccess: false,
        });

        expect(issued.apiKey.directUpstreamAccess).toBe(true);
        expect(withdrawn).toMatchObject({ ok: true, body: { directUpstreamAccess: false } });
      });
    });

    describe('updating a key', () => {
      it('changes the settings sent and clears those sent as null', async () => {
        const [model] = await db.insert(models).values({ name: 'smart' }).returning();
        const issued = await issueKey('cus_1', {
          spendLimit: 10,
          requestRate: 5,
          expiresAt: NEXT_YEAR,
        });

        const updated = await client.updateKey(acme.secret, issued.apiKey.id, {
          name: 'Renamed',
          allowedModelIds: [model.id],
          spendLimit: 20,
          requestRate: null,
          expiresAt: null,
        });

        expect(updated).toEqual({
          ok: true,
          body: {
            ...issued.apiKey,
            name: 'Renamed',
            allowedModelIds: [model.id],
            spendLimit: 20,
            requestRate: undefined,
            expiresAt: undefined,
          },
        });
      });

      it('never changes the Customer id', async () => {
        const issued = await issueKey('cus_1');

        await expect(
          client.updateKey(acme.secret, issued.apiKey.id, { name: 'Moved', customerId: 'cus_2' }),
        ).resolves.toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
        await expect(client.getKey(acme.secret, issued.apiKey.id)).resolves.toMatchObject({
          body: { customerId: 'cus_1' },
        });
      });

      it("refuses allowed Models outside the Integration's", async () => {
        const [sold, kept] = await db
          .insert(models)
          .values([{ name: 'sold' }, { name: 'kept' }])
          .returning();
        await request(app.getHttpServer())
          .patch(`/api/integrations/${acme.id}`)
          .set('Cookie', adaCookie)
          .send({ allowedModelIds: [sold.id] })
          .expect(200);
        const issued = await issueKey('cus_1');

        await expect(
          client.updateKey(acme.secret, issued.apiKey.id, { allowedModelIds: [kept.id] }),
        ).resolves.toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
      });
    });

    describe('rotating and revoking a key', () => {
      it('rotates a key: the new key signs in, the old one no longer does', async () => {
        const issued = await issueKey('cus_1');

        const rotated = await client.rotateKey(acme.secret, issued.apiKey.id);
        if (!rotated.ok) throw new Error(`rotateKey failed with ${rotated.code}`);

        expect(rotated.body.apiKey).toMatchObject({ id: issued.apiKey.id, customerId: 'cus_1' });
        expect(rotated.body.key).not.toBe(issued.key);
        await eventually(() =>
          expect(authenticateWithApiKey(app, rotated.body.key)).resolves.toMatchObject({
            user: { apiKeyId: issued.apiKey.id },
          }),
        );
        await eventually(() => expect(authenticateWithApiKey(app, issued.key)).rejects.toThrow());
      });

      it('revokes a key for good: it stops signing in and can no longer change', async () => {
        const issued = await issueKey('cus_1');

        const revoked = await client.revokeKey(acme.secret, issued.apiKey.id);

        expect(revoked).toMatchObject({ ok: true, body: { revokedAt: expect.any(String) } });
        await eventually(() => expect(authenticateWithApiKey(app, issued.key)).rejects.toThrow());
        await expect(
          client.updateKey(acme.secret, issued.apiKey.id, { name: 'Back' }),
        ).resolves.toEqual({ ok: false, code: 'FAILED_PRECONDITION' });
        await expect(client.rotateKey(acme.secret, issued.apiKey.id)).resolves.toEqual({
          ok: false,
          code: 'FAILED_PRECONDITION',
        });
      });
    });

    describe('listing keys', () => {
      it("lists one Customer's keys, newest first, page by page", async () => {
        const first = await issueKey('cus_1', { name: 'first' });
        await issueKey('cus_2', { name: 'other customer' });
        const second = await issueKey('cus_1', { name: 'second' });
        const third = await issueKey('cus_1', { name: 'third' });

        const firstPage = await client.listKeys(acme.secret, { customerId: 'cus_1', pageSize: 2 });
        if (!firstPage.ok) throw new Error(`listKeys failed with ${firstPage.code}`);
        const lastPage = await client.listKeys(acme.secret, {
          customerId: 'cus_1',
          pageSize: 2,
          pageToken: firstPage.body.nextPageToken,
        });

        expect(firstPage.body.keys.map((key) => key.id)).toEqual([
          third.apiKey.id,
          second.apiKey.id,
        ]);
        expect(lastPage).toEqual({ ok: true, body: { keys: [first.apiKey] } });
      });
    });

    describe('isolation', () => {
      it("answers NOT_FOUND for another Integration's key on every operation", async () => {
        const globex = await createIntegration(app, adaCookie, { name: 'Globex' });
        const theirs = await client.createKey(globex.secret, { customerId: 'cus_1' });
        if (!theirs.ok) throw new Error(`createKey failed with ${theirs.code}`);
        const id = theirs.body.apiKey.id;
        const notFound = { ok: false, code: 'NOT_FOUND' };

        await expect(client.getKey(acme.secret, id)).resolves.toEqual(notFound);
        await expect(client.updateKey(acme.secret, id, { name: 'Mine' })).resolves.toEqual(
          notFound,
        );
        await expect(client.rotateKey(acme.secret, id)).resolves.toEqual(notFound);
        await expect(client.revokeKey(acme.secret, id)).resolves.toEqual(notFound);
        await expect(client.listKeys(acme.secret)).resolves.toEqual({
          ok: true,
          body: { keys: [] },
        });
        await eventually(() =>
          expect(authenticateWithApiKey(app, theirs.body.key)).resolves.toBeTruthy(),
        );
      });

      it("answers NOT_FOUND for an operator's key and for an id naming no key", async () => {
        const operatorKey = await createApiKey(app, adaCookie);
        const notFound = { ok: false, code: 'NOT_FOUND' };

        await expect(client.getKey(acme.secret, operatorKey.id)).resolves.toEqual(notFound);
        await expect(client.revokeKey(acme.secret, operatorKey.id)).resolves.toEqual(notFound);
        await expect(client.getKey(acme.secret, UNKNOWN_ID)).resolves.toEqual(notFound);
        await expect(client.getKey(acme.secret, 'not-a-key-id')).resolves.toEqual(notFound);
        await expect(authenticateWithApiKey(app, operatorKey.key)).resolves.toBeTruthy();
      });
    });
  });
}
