import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { relations } from "@/db/schemas/relations.js";
import { createEmptyDatabase, dropDatabase } from "@tests/support/isolated-database.js";
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from "@tests/support/migrations.js";

const QUOTA_READER_MIGRATION_SUFFIX = "_give_openai_codex_its_quota_reader";
const SEEDED_QUIRKS = { alwaysStreams: true };

describe("OpenAI Codex quota reader migration (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(QUOTA_READER_MIGRATION_SUFFIX);
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, "openai_codex_quota_reader");
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

  async function insertSeededCodex(): Promise<void> {
    await pool.query(
      `insert into providers (slug, name, protocol, base_url, auth_style, is_from_catalog, quirks)
       values ('openai-codex', 'OpenAI Codex', 'openai-responses',
               'https://chatgpt.com/backend-api/codex', 'bearer', true, $1)`,
      [SEEDED_QUIRKS],
    );
  }

  async function migrateToLatest(): Promise<void> {
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });
  }

  async function readCodex() {
    const { rows } = await pool.query<{ quota_reader: string | null; quirks: unknown }>(
      `select quota_reader, quirks from providers where slug = 'openai-codex'`,
    );
    return rows[0];
  }

  it("gives a seeded OpenAI Codex Provider its quota reader and Exhausted error type", async () => {
    await insertSeededCodex();

    await migrateToLatest();

    expect(await readCodex()).toEqual({
      quota_reader: "openai-codex",
      quirks: { ...SEEDED_QUIRKS, exhaustedErrorCodes: ["usage_limit_reached"] },
    });
  });

  it("keeps Exhausted error codes an operator already set", async () => {
    await insertSeededCodex();
    await pool.query(
      `update providers set quirks = '{"exhaustedErrorCodes":["custom"]}' where slug = 'openai-codex'`,
    );

    await migrateToLatest();

    expect(await readCodex()).toEqual({
      quota_reader: "openai-codex",
      quirks: { exhaustedErrorCodes: ["custom"] },
    });
  });
});
