import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { relations } from '@/db/schemas/relations';
import { createEmptyDatabase, dropDatabase } from '@tests/support/isolated-database';
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from '@tests/support/migrations';

const PLAN_LISTS_MIGRATION_SUFFIX = '_list_the_plans_of_catalog_providers';
const OPERATOR_PLANS = [
  { value: 'starter', name: 'Starter' },
  { value: 'scale', name: 'Scale' },
];

describe('Catalog Plan lists migration (e2e)', () => {
  const serverUrl = process.env.DATABASE_URL ?? '';
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(PLAN_LISTS_MIGRATION_SUFFIX);
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, 'catalog_plan_lists');
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

  async function insertProvider(slug: string, isFromCatalog: boolean): Promise<void> {
    await pool.query(
      `insert into providers (slug, name, endpoints, auth_style, is_from_catalog)
       values ($1, $1, '[]', 'bearer', $2)`,
      [slug, isFromCatalog],
    );
  }

  async function migrateToLatest(): Promise<void> {
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });
  }

  async function plansOf(slug: string): Promise<{ plans: unknown; allows_no_plan: boolean }> {
    const { rows } = await pool.query<{ plans: unknown; allows_no_plan: boolean }>(
      'select plans, allows_no_plan from providers where slug = $1',
      [slug],
    );
    return rows[0];
  }

  it('lists the Plans of a seeded TokenHarbor Provider and lets it go without a Plan', async () => {
    await insertProvider('tokenharbor', true);

    await migrateToLatest();

    expect(await plansOf('tokenharbor')).toEqual({
      plans: [
        { value: 'Agent Pass', name: 'Agent Pass' },
        { value: 'Office Pass', name: 'Office Pass' },
        { value: 'Frontier Pass', name: 'Frontier Pass' },
      ],
      allows_no_plan: true,
    });
  });

  it('keeps Plans an operator already listed', async () => {
    await insertProvider('kimi-code', true);
    await pool.query(`update providers set plans = $1 where slug = 'kimi-code'`, [
      JSON.stringify(OPERATOR_PLANS),
    ]);

    await migrateToLatest();

    expect(await plansOf('kimi-code')).toEqual({ plans: OPERATOR_PLANS, allows_no_plan: false });
  });

  it('leaves a Provider an operator added under a Catalog slug alone', async () => {
    await insertProvider('zai-coding-plan', false);

    await migrateToLatest();

    expect(await plansOf('zai-coding-plan')).toEqual({ plans: [], allows_no_plan: false });
  });
});
