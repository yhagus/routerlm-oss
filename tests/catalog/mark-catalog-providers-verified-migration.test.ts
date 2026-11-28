import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { relations } from '@/db/schemas/relations';
import { createEmptyDatabase, dropDatabase } from '@tests/support/isolated-database';
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from '@tests/support/migrations';

const CATALOG_VERIFIED_MIGRATION_SUFFIX = '_mark_catalog_providers_verified';

interface VerifiedRow {
  slug: string;
  verified: boolean;
  verified_at: Date | null;
}

describe('Mark Catalog Providers Verified migration (e2e)', () => {
  const serverUrl = process.env.DATABASE_URL ?? '';
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(CATALOG_VERIFIED_MIGRATION_SUFFIX);
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, 'mark_catalog_providers_verified');
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

  async function insertProvider(
    slug: string,
    isFromCatalog: boolean,
    verifiedAt: Date | null = null,
  ): Promise<void> {
    await pool.query(
      `insert into providers (slug, name, endpoints, auth_style, is_from_catalog, verified, verified_at)
       values ($1, $1, '[]', 'bearer', $2, $3, $4)`,
      [slug, isFromCatalog, verifiedAt !== null, verifiedAt],
    );
  }

  async function migrateToLatest(): Promise<void> {
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });
  }

  async function verifiedRows(): Promise<VerifiedRow[]> {
    const { rows } = await pool.query<VerifiedRow>(
      'select slug, verified, verified_at from providers order by slug',
    );
    return rows;
  }

  it('marks an Unverified Catalog Provider Verified on the day its file was checked', async () => {
    await insertProvider('deepseek', true);

    await migrateToLatest();

    expect(await verifiedRows()).toEqual([
      { slug: 'deepseek', verified: true, verified_at: new Date('2026-11-15T00:00:00Z') },
    ]);
  });

  it('leaves a Catalog Provider whose file opts out Unverified', async () => {
    await insertProvider('tencent-tokenhub-intl', true);

    await migrateToLatest();

    expect(await verifiedRows()).toEqual([
      { slug: 'tencent-tokenhub-intl', verified: false, verified_at: null },
    ]);
  });

  it('keeps the date of a Catalog Provider that was already Verified', async () => {
    await insertProvider('openai', true, new Date('2026-11-27T00:00:00Z'));

    await migrateToLatest();

    expect(await verifiedRows()).toEqual([
      { slug: 'openai', verified: true, verified_at: new Date('2026-11-27T00:00:00Z') },
    ]);
  });

  it('leaves a Provider an operator created under a catalog slug Unverified', async () => {
    await insertProvider('deepseek', false);

    await migrateToLatest();

    expect(await verifiedRows()).toEqual([
      { slug: 'deepseek', verified: false, verified_at: null },
    ]);
  });
});
