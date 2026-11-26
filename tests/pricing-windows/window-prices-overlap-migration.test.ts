import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { relations } from '@/db/schemas/relations';
import { createEmptyDatabase, dropDatabase } from '@tests/support/isolated-database';
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from '@tests/support/migrations';

const NO_OVERLAP_MIGRATION_SUFFIX = '_window_prices_never_overlap';

describe('Window Prices never overlap migration (e2e)', () => {
  const serverUrl = process.env.DATABASE_URL ?? '';
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(NO_OVERLAP_MIGRATION_SUFFIX);
  });

  afterAll(async () => {
    await rm(migrationsBefore, { recursive: true, force: true });
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, 'window_prices_overlap');
    pool = new Pool({ connectionString: databaseUrl });
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: migrationsBefore });
  });

  afterEach(async () => {
    await pool.end();
    await dropDatabase(serverUrl, databaseUrl);
  });

  async function insertReturningId(sql: string, values: unknown[] = []): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(`${sql} returning id`, values);
    return rows[0].id;
  }

  async function insertUpstreamModel(upstreamModelId: string): Promise<string> {
    const providerId = await insertReturningId(
      `insert into providers (slug, name, endpoints, auth_style)
       values ($1, 'Acme AI', '[]', 'bearer')`,
      [`acme-${upstreamModelId}`],
    );
    return insertReturningId(
      `insert into upstream_models (provider_id, upstream_model_id, context_size, input_price)
       values ($1, $2, 128000, 2)`,
      [providerId, upstreamModelId],
    );
  }

  async function insertPricingWindow(name: string): Promise<string> {
    return insertReturningId(
      `insert into pricing_windows (name, time_zone, ranges)
       values ($1, 'UTC', '[{"weekdays":[1],"start":"01:00","end":"02:00"}]')`,
      [name],
    );
  }

  async function attach(upstreamModelId: string, pricingWindowId: string, position: number) {
    await pool.query(
      `insert into upstream_model_pricing_windows
         (upstream_model_id, pricing_window_id, position, input_price)
       values ($1, $2, $3, 1)`,
      [upstreamModelId, pricingWindowId, position],
    );
  }

  it('stops before changing anything, naming each Upstream Model with several windows and its windows', async () => {
    const largeId = await insertUpstreamModel('acme-large');
    await attach(largeId, await insertPricingWindow('Night'), 0);
    await attach(largeId, await insertPricingWindow('Weekend'), 1);

    await expect(
      migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/acme-large \(Acme AI\): Night, Weekend/) },
    });

    const { rows } = await pool.query(
      `select count(*)::int as attachments from upstream_model_pricing_windows where position is not null`,
    );
    expect(rows).toEqual([{ attachments: 2 }]);
  });

  it('migrates a single attachment unchanged', async () => {
    const largeId = await insertUpstreamModel('acme-large');
    const nightId = await insertPricingWindow('Night');
    await attach(largeId, nightId, 0);

    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });

    const { rows } = await pool.query(
      `select upstream_model_id, pricing_window_id, input_price from upstream_model_pricing_windows`,
    );
    expect(rows).toEqual([
      { upstream_model_id: largeId, pricing_window_id: nightId, input_price: '1.000000' },
    ]);
  });
});
