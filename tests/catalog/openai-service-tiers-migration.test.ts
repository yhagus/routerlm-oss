import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { relations } from '@/db/schemas/relations';
import { createEmptyDatabase, dropDatabase } from '@tests/support/isolated-database';
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from '@tests/support/migrations';

const SERVICE_TIERS_MIGRATION_SUFFIX = '_give_openai_its_service_tiers';
const OPENAI_TIER_VALUES = { fast: 'priority', flex: 'flex' };

describe('OpenAI Service Tiers migration (e2e)', () => {
  const serverUrl = process.env.DATABASE_URL ?? '';
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(SERVICE_TIERS_MIGRATION_SUFFIX);
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, 'openai_service_tiers');
    pool = new Pool({ connectionString: databaseUrl });
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: migrationsBefore });
  });

  afterEach(async () => {
    await pool.end();
    await dropDatabase(serverUrl, databaseUrl);
  });

  afterAll(async () => {
    await rm(migrationsBefore, { recursive: true, force: true });
  });

  async function insertSeededOpenAi(): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into providers (slug, name, protocol, base_url, auth_style, is_from_catalog)
       values ('openai', 'OpenAI', 'openai-chat', 'https://api.openai.com/v1', 'bearer', true)
       returning id`,
    );
    await pool.query(
      `insert into upstream_models (provider_id, upstream_model_id, context_size)
       values ($1, 'gpt-6-sol', 272000)`,
      [rows[0]?.id],
    );
  }

  async function migrateToLatest(): Promise<void> {
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });
  }

  async function readOpenAi() {
    const { rows } = await pool.query<{
      service_tier_values: unknown;
      service_tiers: string[];
      tier_prices: unknown;
    }>(
      `select p.service_tier_values, m.service_tiers, m.tier_prices
       from providers p join upstream_models m on m.provider_id = p.id
       where p.slug = 'openai'`,
    );
    return rows[0];
  }

  it("gives a seeded OpenAI Provider and its models the Catalog's Service Tiers", async () => {
    await insertSeededOpenAi();

    await migrateToLatest();

    expect(await readOpenAi()).toEqual({
      service_tier_values: OPENAI_TIER_VALUES,
      service_tiers: ['fast', 'flex'],
      tier_prices: {
        fast: { inputPrice: 4, outputPrice: 20, cacheReadPrice: 0.4, cacheWritePrice: 5 },
        flex: { inputPrice: 1, outputPrice: 5, cacheReadPrice: 0.1, cacheWritePrice: 1.25 },
      },
    });
  });

  it('keeps Service Tiers an operator already set', async () => {
    await insertSeededOpenAi();
    await pool.query(
      `update providers set service_tier_values = '{"flex":"flex"}' where slug = 'openai'`,
    );
    await pool.query(`update upstream_models set service_tiers = '{flex}'`);

    await migrateToLatest();

    expect(await readOpenAi()).toMatchObject({
      service_tier_values: { flex: 'flex' },
      service_tiers: ['flex'],
      tier_prices: {},
    });
  });
});
