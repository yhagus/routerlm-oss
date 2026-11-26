import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import request from 'supertest';
import { type Database, relations } from '@/db/schemas/relations';
import { createEmptyDatabase, dropDatabase } from '@tests/support/isolated-database';
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from '@tests/support/migrations';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';

const CREDENTIAL_KINDS_MIGRATION_SUFFIX = '_provider_account_credential_kinds';
const OPERATOR = { email: 'ops@example.com', password: 'ops password' };

describe('Provider Account credential kinds on an upgraded install (e2e)', () => {
  const serverUrl = process.env.DATABASE_URL ?? '';
  let migrationsBeforeCredentialKinds: string;
  let databaseUrl: string;
  let pool: Pool;
  let db: Database;
  let providerId: string;

  beforeAll(async () => {
    migrationsBeforeCredentialKinds = await copyMigrationsBefore(CREDENTIAL_KINDS_MIGRATION_SUFFIX);
    databaseUrl = await createEmptyDatabase(serverUrl, 'credential_kinds');
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle({ client: pool, relations });
    await migrate(db, { migrationsFolder: migrationsBeforeCredentialKinds });
    const { rows } = await pool.query<{ id: string }>(
      `insert into providers (slug, name, protocol, base_url, auth_style)
       values ('acme', 'Acme AI', 'openai-chat', 'https://api.acme.example/v1', 'bearer')
       returning id`,
    );
    providerId = rows[0].id;
    await pool.query(
      `insert into provider_accounts (provider_id, name, encrypted_key, key_last_four)
       values ($1, 'main', 'ciphertext-of-the-key', 'WXYZ')`,
      [providerId],
    );
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await pool.end();
    await dropDatabase(serverUrl, databaseUrl);
    await rm(migrationsBeforeCredentialKinds, { recursive: true, force: true });
  });

  it('keeps a Provider Account from before credential kinds, as one holding an API key', async () => {
    const { app } = await createTestApp(db);
    const cookie = await setUpFirstUser(app, OPERATOR);

    const list = await request(app.getHttpServer())
      .get('/api/provider-accounts')
      .set('Cookie', cookie)
      .expect(200);
    await app.close();

    expect(list.body).toMatchObject([
      { name: 'main', credentialKind: 'api-key', keyLastFour: 'WXYZ' },
    ]);
  });

  it('refuses an OAuth Login account that holds a key and no tokens', async () => {
    const inserted = pool.query(
      `insert into provider_accounts (provider_id, name, credential_kind, encrypted_key)
       values ($1, 'mismatched', 'oauth-login', 'ciphertext-of-the-key')`,
      [providerId],
    );

    await expect(inserted).rejects.toThrow(/provider_accounts_credential_kind_check/);
  });

  it('refuses an API key account that holds tokens and no key', async () => {
    const inserted = pool.query(
      `insert into provider_accounts
         (provider_id, name, credential_kind, oauth_encrypted_access_token, oauth_encrypted_refresh_token)
       values ($1, 'mismatched', 'api-key', 'ciphertext-of-the-access-token', 'ciphertext-of-the-refresh-token')`,
      [providerId],
    );

    await expect(inserted).rejects.toThrow(/provider_accounts_credential_kind_check/);
  });
});
