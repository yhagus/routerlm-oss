import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { relations } from "@/db/schemas/relations.js";
import { createEmptyDatabase, dropDatabase } from "@tests/support/isolated-database.js";
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from "@tests/support/migrations.js";

const PRICING_WINDOWS_MIGRATION_SUFFIX = "_pricing_windows";

describe("Pricing Windows migrations (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(PRICING_WINDOWS_MIGRATION_SUFFIX);
    databaseUrl = await createEmptyDatabase(serverUrl, "pricing_windows");
    pool = new Pool({ connectionString: databaseUrl });
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: migrationsBefore });
  });

  afterAll(async () => {
    await pool.end();
    await dropDatabase(serverUrl, databaseUrl);
    await rm(migrationsBefore, { recursive: true, force: true });
  });

  async function insertReturningId(sql: string, values: unknown[] = []): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(`${sql} returning id`, values);
    return rows[0].id;
  }

  it("keeps existing Upstream Models without windows and gives existing Usage Logs no window name", async () => {
    const providerId = await insertReturningId(
      `insert into providers (slug, name, endpoints, auth_style)
       values ('acme', 'Acme AI', '[]', 'bearer')`,
    );
    const upstreamModelId = await insertReturningId(
      `insert into upstream_models (provider_id, upstream_model_id, context_size, input_price)
       values ($1, 'acme-large', 128000, 2)`,
      [providerId],
    );
    const usageLogId = await insertReturningId(
      `insert into usage_logs (created_at, client_protocol, is_streamed, http_status, request_bytes,
         response_bytes, duration_ms, attempt_count, upstream_model_id, cost)
       values (now(), 'openai-chat', false, 200, 1, 1, 1, 1, $1, 0.5)`,
      [upstreamModelId],
    );

    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });

    const usageLogs = await pool.query(
      `select pricing_window_name, cost from usage_logs where id = $1`,
      [usageLogId],
    );
    expect(usageLogs.rows).toEqual([{ pricing_window_name: null, cost: "0.5000000000" }]);
    const upstreamModels = await pool.query(
      `select input_price,
         (select count(*)::int from upstream_model_pricing_windows w
          where w.upstream_model_id = upstream_models.id) as window_count
       from upstream_models where id = $1`,
      [upstreamModelId],
    );
    expect(upstreamModels.rows).toEqual([{ input_price: "2.000000", window_count: 0 }]);
  });
});
