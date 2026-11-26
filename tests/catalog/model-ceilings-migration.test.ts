import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { relations } from "@/db/schemas/relations";
import { createEmptyDatabase, dropDatabase } from "@tests/support/isolated-database";
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from "@tests/support/migrations";

const CEILINGS_MIGRATION_SUFFIX = "_raise_catalog_models_to_their_ceilings";

type SeededModel = { contextSize: number; maxOutputTokens: number | null };

describe("Catalog model ceilings migration (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(CEILINGS_MIGRATION_SUFFIX);
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, "model_ceilings");
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
    models: Record<string, SeededModel>,
    isFromCatalog = true,
  ): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into providers (slug, name, protocol, base_url, auth_style, is_from_catalog)
       values ($1, $1, 'openai-chat', 'https://example.test/v1', 'bearer', $2)
       returning id`,
      [slug, isFromCatalog],
    );
    for (const [upstreamModelId, { contextSize, maxOutputTokens }] of Object.entries(models)) {
      await pool.query(
        `insert into upstream_models (provider_id, upstream_model_id, context_size, max_output_tokens)
         values ($1, $2, $3, $4)`,
        [rows[0]?.id, upstreamModelId, contextSize, maxOutputTokens],
      );
    }
  }

  async function migrateToLatest(): Promise<void> {
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });
  }

  async function readModels(slug: string): Promise<Record<string, SeededModel>> {
    const { rows } = await pool.query<{
      upstream_model_id: string;
      context_size: number;
      max_output_tokens: number | null;
    }>(
      `select m.upstream_model_id, m.context_size, m.max_output_tokens
       from upstream_models m join providers p on p.id = m.provider_id
       where p.slug = $1`,
      [slug],
    );
    return Object.fromEntries(
      rows.map((row) => [
        row.upstream_model_id,
        { contextSize: row.context_size, maxOutputTokens: row.max_output_tokens },
      ]),
    );
  }

  it("raises Kimi K3 models seeded with the old defaults to their ceilings", async () => {
    await insertProvider("moonshot", {
      "kimi-k3": { contextSize: 1048576, maxOutputTokens: 131072 },
    });
    await insertProvider("kimi-code", {
      k3: { contextSize: 262144, maxOutputTokens: 131072 },
      "k3-256k": { contextSize: 262144, maxOutputTokens: 131072 },
    });

    await migrateToLatest();

    expect(await readModels("moonshot")).toEqual({
      "kimi-k3": { contextSize: 1048576, maxOutputTokens: 1048576 },
    });
    expect(await readModels("kimi-code")).toEqual({
      k3: { contextSize: 1048576, maxOutputTokens: 1048576 },
      "k3-256k": { contextSize: 262144, maxOutputTokens: 262144 },
    });
  });

  it("raises OpenAI Codex models to their max context window", async () => {
    await insertProvider("openai-codex", {
      "gpt-6-sol": { contextSize: 272000, maxOutputTokens: 128000 },
      "gpt-5.5": { contextSize: 272000, maxOutputTokens: 128000 },
    });

    await migrateToLatest();

    expect(await readModels("openai-codex")).toEqual({
      "gpt-6-sol": { contextSize: 872000, maxOutputTokens: 128000 },
      "gpt-5.5": { contextSize: 272000, maxOutputTokens: 128000 },
    });
  });

  it("keeps values an operator edited", async () => {
    await insertProvider("kimi-code", {
      k3: { contextSize: 524288, maxOutputTokens: 65536 },
    });

    await migrateToLatest();

    expect(await readModels("kimi-code")).toEqual({
      k3: { contextSize: 524288, maxOutputTokens: 65536 },
    });
  });

  it("leaves a Provider the operator added under a Catalog slug alone", async () => {
    await insertProvider(
      "moonshot",
      { "kimi-k3": { contextSize: 1048576, maxOutputTokens: 131072 } },
      false,
    );

    await migrateToLatest();

    expect(await readModels("moonshot")).toEqual({
      "kimi-k3": { contextSize: 1048576, maxOutputTokens: 131072 },
    });
  });
});
