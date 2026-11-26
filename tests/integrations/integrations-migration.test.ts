import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { relations } from "@/db/schemas/relations";
import { createEmptyDatabase, dropDatabase } from "@tests/support/isolated-database";
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from "@tests/support/migrations";

const INTEGRATIONS_MIGRATION_SUFFIX = "_integrations";

describe("Integrations migration (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(INTEGRATIONS_MIGRATION_SUFFIX);
    databaseUrl = await createEmptyDatabase(serverUrl, "integrations");
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

  it("keeps existing API Keys and Usage Logs as operator ones, with nothing spent", async () => {
    const apiKeyId = await insertReturningId(
      `insert into api_keys (name, key_id, hash) values ('CI', 'ci', 'hash-ci')`,
    );
    const usageLogId = await insertReturningId(
      `insert into usage_logs (created_at, client_protocol, is_streamed, http_status, request_bytes,
         response_bytes, duration_ms, attempt_count, api_key_id, api_key_name)
       values ('2026-11-10T10:00:00Z', 'openai-chat', false, 200, 1, 1, 1, 1, $1, 'CI')`,
      [apiKeyId],
    );
    await pool.query(
      `insert into attempts (usage_log_id, started_at, api_key_name, duration_ms)
       values ($1, '2026-11-10T10:00:00Z', 'CI', 1)`,
      [usageLogId],
    );

    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });

    const keys = await pool.query(
      `select id, name, integration_id, customer_id, spend_limit, spent, request_rate from api_keys`,
    );
    expect(keys.rows).toEqual([
      {
        id: apiKeyId,
        name: "CI",
        integration_id: null,
        customer_id: null,
        spend_limit: null,
        spent: "0.0000000000",
        request_rate: null,
      },
    ]);
    const logs = await pool.query(
      `select id, api_key_name, integration_id, integration_name, customer_id from usage_logs`,
    );
    expect(logs.rows).toEqual([
      {
        id: usageLogId,
        api_key_name: "CI",
        integration_id: null,
        integration_name: null,
        customer_id: null,
      },
    ]);
    const attempts = await pool.query(
      `select api_key_name, integration_name, customer_id from attempts`,
    );
    expect(attempts.rows).toEqual([
      { api_key_name: "CI", integration_name: null, customer_id: null },
    ]);
  });
});
