import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { relations } from '@/db/schemas/relations';
import { createEmptyDatabase, dropDatabase } from '@tests/support/isolated-database';
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from '@tests/support/migrations';

const NOT_IN_PLAN_MIGRATION_SUFFIX = '_give_tokenharbor_its_not_in_plan_code';
const SEEDED_QUIRKS = { fixedHeaders: { 'x-client': 'gateway' } };

describe('TokenHarbor not-in-plan code migration (e2e)', () => {
  const serverUrl = process.env.DATABASE_URL ?? '';
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(NOT_IN_PLAN_MIGRATION_SUFFIX);
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, 'tokenharbor_not_in_plan');
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

  async function insertSeededTokenHarbor(): Promise<void> {
    await pool.query(
      `insert into providers (slug, name, endpoints, auth_style, is_from_catalog, quirks)
       values ('tokenharbor', 'TokenHarbor', '[]', 'bearer', true, $1)`,
      [SEEDED_QUIRKS],
    );
  }

  async function migrateToLatest(): Promise<void> {
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });
  }

  async function quirksOfTokenHarbor(): Promise<unknown> {
    const { rows } = await pool.query<{ quirks: unknown }>(
      `select quirks from providers where slug = 'tokenharbor'`,
    );
    return rows[0]?.quirks;
  }

  it('gives a seeded TokenHarbor Provider its not-in-plan error code', async () => {
    await insertSeededTokenHarbor();

    await migrateToLatest();

    expect(await quirksOfTokenHarbor()).toEqual({
      ...SEEDED_QUIRKS,
      notInPlanErrorCodes: ['model_not_in_plan'],
    });
  });

  it('keeps not-in-plan error codes an operator already set', async () => {
    await insertSeededTokenHarbor();
    await pool.query(
      `update providers set quirks = '{"notInPlanErrorCodes":["custom"]}' where slug = 'tokenharbor'`,
    );

    await migrateToLatest();

    expect(await quirksOfTokenHarbor()).toEqual({ notInPlanErrorCodes: ['custom'] });
  });
});
