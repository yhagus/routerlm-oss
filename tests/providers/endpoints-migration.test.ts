import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { relations } from "@/db/schemas/relations";
import { createEmptyDatabase, dropDatabase } from "@tests/support/isolated-database";
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from "@tests/support/migrations";

const ENDPOINTS_MIGRATION_SUFFIX = "_provider_endpoints";

describe("Provider endpoints migration (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(ENDPOINTS_MIGRATION_SUFFIX);
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, "provider_endpoints");
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

  async function insertProvider(slug: string, protocol: string, baseUrl: string, tierValues = {}) {
    await pool.query(
      `insert into providers (slug, name, protocol, base_url, auth_style, service_tier_values)
       values ($1, $1, $2, $3, 'bearer', $4)`,
      [slug, protocol, baseUrl, JSON.stringify(tierValues)],
    );
  }

  async function migrateToLatest() {
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });
  }

  it("turns every Provider's Protocol and base URL into its chat endpoint", async () => {
    await insertProvider("anthropic-ish", "anthropic-messages", "https://api.anthropic.example");
    await insertProvider("openai-ish", "openai-chat", "https://api.openai.example/v1");

    await migrateToLatest();

    const providers = await pool.query("select * from providers order by slug");
    expect(providers.rows).toEqual([
      expect.objectContaining({
        slug: "anthropic-ish",
        endpoints: [
          {
            kind: "chat",
            protocol: "anthropic-messages",
            baseUrl: "https://api.anthropic.example",
          },
        ],
      }),
      expect.objectContaining({
        slug: "openai-ish",
        endpoints: [
          { kind: "chat", protocol: "openai-chat", baseUrl: "https://api.openai.example/v1" },
        ],
      }),
    ]);
    expect(providers.rows[0]).not.toHaveProperty("protocol");
    expect(providers.rows[0]).not.toHaveProperty("base_url");
  });

  it("still refuses Service Tier values unless the chat endpoint sends tiers", async () => {
    await insertProvider("anthropic-ish", "anthropic-messages", "https://api.anthropic.example");
    await insertProvider("openai-ish", "openai-chat", "https://api.openai.example/v1");
    await migrateToLatest();

    await expect(
      pool.query(
        `update providers set service_tier_values = '{"fast":"priority"}' where slug = 'anthropic-ish'`,
      ),
    ).rejects.toThrow(/providers_service_tier_values_protocol_check/);
    await pool.query(
      `update providers set service_tier_values = '{"fast":"priority"}' where slug = 'openai-ish'`,
    );
  });
});
