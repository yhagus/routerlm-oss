import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { relations } from '@/db/schemas/relations';
import { createEmptyDatabase, dropDatabase } from '@tests/support/isolated-database';
import { copyMigrationsBefore } from '@tests/support/migrations';

const VERIFIED_MIGRATION_SUFFIX = '_mark_providers_verified';
const LATER_CATALOG_VERIFIED_MIGRATION_SUFFIX = '_mark_catalog_providers_verified';

interface VerifiedRow {
  slug: string;
  verified: boolean;
  verified_at: Date | null;
}

describe('Mark Providers Verified migration (e2e)', () => {
  const serverUrl = process.env.DATABASE_URL ?? '';
  let migrationsBefore: string;
  let migrationsThroughVerified: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(VERIFIED_MIGRATION_SUFFIX);
    migrationsThroughVerified = await copyMigrationsBefore(LATER_CATALOG_VERIFIED_MIGRATION_SUFFIX);
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, 'mark_providers_verified');
    pool = new Pool({ connectionString: databaseUrl });
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: migrationsBefore });
  });

  afterEach(async () => {
    await pool.end();
    await dropDatabase(serverUrl, databaseUrl);
  });

  afterAll(async () => {
    await rm(migrationsBefore, { recursive: true, force: true });
    await rm(migrationsThroughVerified, { recursive: true, force: true });
  });

  async function insertProvider(slug: string, isFromCatalog: boolean): Promise<void> {
    await pool.query(
      `insert into providers (slug, name, endpoints, auth_style, is_from_catalog)
       values ($1, $1, '[]', 'bearer', $2)`,
      [slug, isFromCatalog],
    );
  }

  async function migrateThroughVerified(): Promise<void> {
    await migrate(drizzle({ client: pool, relations }), {
      migrationsFolder: migrationsThroughVerified,
    });
  }

  async function verifiedRows(): Promise<VerifiedRow[]> {
    const { rows } = await pool.query<VerifiedRow>(
      'select slug, verified, verified_at from providers order by slug',
    );
    return rows;
  }

  it('marks TokenHarbor and ClinePass Verified on the days they were checked', async () => {
    await insertProvider('clinepass', true);
    await insertProvider('deepseek', true);
    await insertProvider('tokenharbor', true);

    await migrateThroughVerified();

    expect(await verifiedRows()).toEqual([
      { slug: 'clinepass', verified: true, verified_at: new Date('2026-11-22T00:00:00Z') },
      { slug: 'deepseek', verified: false, verified_at: null },
      { slug: 'tokenharbor', verified: true, verified_at: new Date('2026-11-26T00:00:00Z') },
    ]);
  });

  it('leaves a Provider an operator created under one of the slugs Unverified', async () => {
    await insertProvider('tokenharbor', false);

    await migrateThroughVerified();

    expect(await verifiedRows()).toEqual([
      { slug: 'tokenharbor', verified: false, verified_at: null },
    ]);
  });
});
