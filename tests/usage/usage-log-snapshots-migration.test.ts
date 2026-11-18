import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { relations } from "@/db/schemas/relations.js";
import { createEmptyDatabase, dropDatabase } from "../support/isolated-database.js";
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from "../support/migrations.js";

const SNAPSHOTS_MIGRATION_SUFFIX = "_usage_log_snapshots";

describe("Usage Log snapshots migration (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(SNAPSHOTS_MIGRATION_SUFFIX);
    databaseUrl = await createEmptyDatabase(serverUrl, "usage_log_snapshots");
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

  async function insertUsageLog(columns: {
    apiKeyId: string | null;
    modelId: string | null;
    routeId: string | null;
    providerAccountId: string | null;
  }): Promise<string> {
    return insertReturningId(
      `insert into usage_logs (created_at, client_protocol, is_streamed, http_status, request_bytes,
         response_bytes, duration_ms, attempt_count, api_key_id, model_id, route_id, provider_account_id)
       values (now(), 'openai-chat', false, 200, 1, 1, 1, 1, $1, $2, $3, $4)`,
      [columns.apiKeyId, columns.modelId, columns.routeId, columns.providerAccountId],
    );
  }

  it("keeps existing Usage Logs and Attempts, copying the names of what still exists", async () => {
    const providerId = await insertReturningId(
      `insert into providers (slug, name, protocol, base_url, auth_style)
       values ('acme', 'Acme AI', 'openai-chat', 'https://api.acme.example/v1', 'bearer')`,
    );
    const providerAccountId = await insertReturningId(
      `insert into provider_accounts (provider_id, name, encrypted_key, key_last_four)
       values ($1, 'main', 'ciphertext', 'AAAA')`,
      [providerId],
    );
    const upstreamModelId = await insertReturningId(
      `insert into upstream_models (provider_id, upstream_model_id, context_size)
       values ($1, 'acme-large-2026', 128000)`,
      [providerId],
    );
    const modelId = await insertReturningId(`insert into models (name) values ('smart')`);
    const routeId = await insertReturningId(
      `insert into routes (model_id, upstream_model_id) values ($1, $2)`,
      [modelId, upstreamModelId],
    );
    const apiKeyId = await insertReturningId(
      `insert into api_keys (name, key_id, hash) values ('CI', 'ci', 'hash-ci')`,
    );
    const resolvedLogId = await insertUsageLog({ apiKeyId, modelId, routeId, providerAccountId });
    await pool.query(
      `insert into attempts (usage_log_id, started_at, route_id, provider_account_id, duration_ms)
       values ($1, now(), $2, $3, 1)`,
      [resolvedLogId, routeId, providerAccountId],
    );
    // Its configuration was deleted before this migration, which cleared its links.
    const orphanLogId = await insertUsageLog({
      apiKeyId: null,
      modelId: null,
      routeId: null,
      providerAccountId: null,
    });

    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });

    const logs = await pool.query(
      `select id, model_name, api_key_name, upstream_model_id, upstream_model_name, provider_slug,
         provider_account_name from usage_logs`,
    );
    expect(logs.rows).toEqual(
      expect.arrayContaining([
        {
          id: resolvedLogId,
          model_name: "smart",
          api_key_name: "CI",
          upstream_model_id: upstreamModelId,
          upstream_model_name: "acme-large-2026",
          provider_slug: "acme",
          provider_account_name: "main",
        },
        {
          id: orphanLogId,
          model_name: null,
          api_key_name: null,
          upstream_model_id: null,
          upstream_model_name: null,
          provider_slug: null,
          provider_account_name: null,
        },
      ]),
    );
    expect(logs.rows).toHaveLength(2);
    const attempts = await pool.query(
      `select model_name, api_key_name, upstream_model_id, upstream_model_name, provider_slug,
         provider_account_name from attempts`,
    );
    expect(attempts.rows).toEqual([
      {
        model_name: "smart",
        api_key_name: "CI",
        upstream_model_id: upstreamModelId,
        upstream_model_name: "acme-large-2026",
        provider_slug: "acme",
        provider_account_name: "main",
      },
    ]);
  });
});
