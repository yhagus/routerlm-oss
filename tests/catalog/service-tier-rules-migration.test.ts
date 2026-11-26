import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { relations } from "@/db/schemas/relations";
import { createEmptyDatabase, dropDatabase } from "@tests/support/isolated-database";
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from "@tests/support/migrations";

const RULES_MIGRATION_SUFFIX = "_service_tier_rules";

describe("Service Tier rules migration (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(RULES_MIGRATION_SUFFIX);
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, "service_tier_rules");
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

  async function insertProvider(slug: string, protocol: string, tierValues: object) {
    const { rows } = await pool.query<{ id: string }>(
      `insert into providers (slug, name, protocol, base_url, auth_style, service_tier_values)
       values ($1, $1, $2, 'https://x.example', 'bearer', $3) returning id`,
      [slug, protocol, JSON.stringify(tierValues)],
    );
    return rows[0]?.id;
  }

  async function insertModel(providerId: string | undefined, tiers: string, prices: object) {
    await pool.query(
      `insert into upstream_models (provider_id, upstream_model_id, context_size, service_tiers, tier_prices)
       values ($1, 'm', 1000, $2::text[], $3)`,
      [providerId, tiers, JSON.stringify(prices)],
    );
  }

  async function migrateToLatest() {
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });
  }

  it("clears tiers on a Protocol that never sends one and prices of unlisted tiers, and keeps the rest", async () => {
    const tiers = { fast: "priority", flex: "flex" };
    const anthropic = await insertProvider("anthropic-ish", "anthropic-messages", tiers);
    await insertModel(anthropic, "{fast}", { fast: { inputPrice: 1 } });
    const openai = await insertProvider("openai-ish", "openai-chat", tiers);
    await insertModel(openai, "{fast}", { fast: { inputPrice: 1 }, flex: { inputPrice: 2 } });

    await migrateToLatest();

    const providers = await pool.query(
      "select slug, service_tier_values from providers order by slug",
    );
    const models = await pool.query(
      `select p.slug, m.service_tiers, m.tier_prices
       from upstream_models m join providers p on p.id = m.provider_id order by p.slug`,
    );
    expect(providers.rows).toEqual([
      { slug: "anthropic-ish", service_tier_values: {} },
      { slug: "openai-ish", service_tier_values: tiers },
    ]);
    expect(models.rows).toEqual([
      { slug: "anthropic-ish", service_tiers: [], tier_prices: {} },
      { slug: "openai-ish", service_tiers: ["fast"], tier_prices: { fast: { inputPrice: 1 } } },
    ]);
  });

  it("makes the database refuse what the rules refuse", async () => {
    const anthropic = await insertProvider("a", "anthropic-messages", {});
    await migrateToLatest();

    await expect(
      pool.query(`update providers set service_tier_values = '{"fast":"priority"}' where id = $1`, [
        anthropic,
      ]),
    ).rejects.toThrow(/providers_service_tier_values_protocol_check/);
    await expect(insertModel(anthropic, "{}", { fast: { inputPrice: 1 } })).rejects.toThrow(
      /upstream_models_tier_prices_listed_check/,
    );
  });
});
