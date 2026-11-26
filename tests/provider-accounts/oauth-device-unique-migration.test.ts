import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { relations } from '@/db/schemas/relations';
import { createEmptyDatabase, dropDatabase } from '@tests/support/isolated-database';
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from '@tests/support/migrations';

const UNIQUE_DEVICE_MIGRATION_SUFFIX = '_provider_account_oauth_device_unique';

describe('Provider Account OAuth device uniqueness migration (e2e)', () => {
  const serverUrl = process.env.DATABASE_URL ?? '';
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(UNIQUE_DEVICE_MIGRATION_SUFFIX);
    databaseUrl = await createEmptyDatabase(serverUrl, 'oauth_device_unique');
    pool = new Pool({ connectionString: databaseUrl });
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: migrationsBefore });
  });

  afterAll(async () => {
    await pool.end();
    await dropDatabase(serverUrl, databaseUrl);
    await rm(migrationsBefore, { recursive: true, force: true });
  });

  async function insertOauthAccount(providerId: string, name: string, deviceId: string) {
    const { rows } = await pool.query<{ id: string }>(
      `insert into provider_accounts (provider_id, name, credential_kind, oauth_encrypted_access_token,
         oauth_encrypted_refresh_token, oauth_device_id)
       values ($1, $2, 'oauth-login', 'access', 'refresh', $3) returning id`,
      [providerId, name, deviceId],
    );
    return rows[0].id;
  }

  it('keeps the duplicate that served requests, with its history, and leaves API key accounts alone', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into providers (slug, name, protocol, base_url, auth_style)
       values ('acme', 'Acme AI', 'openai-chat', 'https://api.acme.example/v1', 'bearer')
       returning id`,
    );
    const providerId = rows[0].id;
    const unused = await insertOauthAccount(providerId, 'first', 'device-1');
    const inUse = await insertOauthAccount(providerId, 'second', 'device-1');
    const otherSignIn = await insertOauthAccount(providerId, 'third', 'device-2');
    await pool.query(
      `insert into provider_accounts (provider_id, name, encrypted_key, key_last_four)
       values ($1, 'key a', 'ciphertext', 'AAAA'), ($1, 'key b', 'ciphertext', 'BBBB')`,
      [providerId],
    );
    await pool.query(
      `insert into usage_logs (created_at, client_protocol, is_streamed, http_status, request_bytes,
         response_bytes, duration_ms, attempt_count, provider_account_id)
       values (now(), 'openai-chat', false, 200, 1, 1, 1, 1, $1)`,
      [inUse],
    );

    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });

    const accounts = await pool.query<{ id: string }>('select id from provider_accounts');
    const accountIds = accounts.rows.map((row) => row.id);
    expect(accountIds).toHaveLength(4);
    expect(accountIds).toContain(inUse);
    expect(accountIds).toContain(otherSignIn);
    expect(accountIds).not.toContain(unused);
    const logs = await pool.query<{ provider_account_id: string }>(
      'select provider_account_id from usage_logs',
    );
    expect(logs.rows).toEqual([{ provider_account_id: inUse }]);
  });
});
