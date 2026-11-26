import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { relations } from '@/db/schemas/relations';
import { createEmptyDatabase, dropDatabase } from '@tests/support/isolated-database';
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from '@tests/support/migrations';

const UNFLAG_MIGRATION_SUFFIX = '_unflag_providers_that_publish_their_inference';
const UNFLAGGED_SLUGS = [
  'alibaba-token-plan',
  'clinepass',
  'meta-ai',
  'minimax-m-plan',
  'tokenrouter-com',
  'xiaomi-mimo-token-plan',
  'zai-coding-plan',
];
const STILL_FLAGGED_SLUGS = ['kimi-code', 'openai-codex'];

describe('Unflag Providers that publish their inference migration (e2e)', () => {
  const serverUrl = process.env.DATABASE_URL ?? '';
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(UNFLAG_MIGRATION_SUFFIX);
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, 'unflag_terms_risk_providers');
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

  async function insertFlaggedProvider(slug: string, isFromCatalog: boolean): Promise<void> {
    await pool.query(
      `insert into providers (slug, name, endpoints, auth_style, is_from_catalog, terms_risk)
       values ($1, $1, '[]', 'bearer', $2, true)`,
      [slug, isFromCatalog],
    );
  }

  async function migrateToLatest(): Promise<void> {
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });
  }

  async function termsRiskBySlug(): Promise<Record<string, boolean>> {
    const { rows } = await pool.query<{ slug: string; terms_risk: boolean }>(
      'select slug, terms_risk from providers',
    );
    return Object.fromEntries(rows.map((row) => [row.slug, row.terms_risk]));
  }

  it('unflags the seven Providers and keeps Kimi Code and OpenAI Codex flagged', async () => {
    for (const slug of [...UNFLAGGED_SLUGS, ...STILL_FLAGGED_SLUGS]) {
      await insertFlaggedProvider(slug, true);
    }

    await migrateToLatest();

    expect(await termsRiskBySlug()).toEqual({
      ...Object.fromEntries(UNFLAGGED_SLUGS.map((slug) => [slug, false])),
      ...Object.fromEntries(STILL_FLAGGED_SLUGS.map((slug) => [slug, true])),
    });
  });

  it('leaves a Provider an operator created under one of the slugs untouched', async () => {
    await insertFlaggedProvider('clinepass', false);

    await migrateToLatest();

    expect(await termsRiskBySlug()).toEqual({ clinepass: true });
  });
});
