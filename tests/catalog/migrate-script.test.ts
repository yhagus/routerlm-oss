import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { providers } from "@/db/schemas/index.js";
import { type Database, relations } from "@/db/schemas/relations.js";
import { createEmptyDatabase, dropDatabase } from "../support/isolated-database.js";

const runFile = promisify(execFile);
// Bun startup, every migration and seeding every shipped Catalog file.
const MIGRATE_TIMEOUT_MS = 60_000;
const SHIPPED_PROVIDER_COUNT = 10;

describe("production migrate entrypoint (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let databaseUrl: string;
  let pool: Pool;
  let db: Database;

  // A DATABASE_URL in the environment wins over the one in the developer's .env.
  const runMigrate = () =>
    runFile("bun", ["src/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: MIGRATE_TIMEOUT_MS,
    });

  beforeAll(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, "migrate_script");
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    await pool?.end();
    if (databaseUrl) await dropDatabase(serverUrl, databaseUrl);
  });

  it(
    "migrates an empty database and seeds the Catalog Providers",
    async () => {
      await runMigrate();

      const seeded = await db.select({ slug: providers.slug }).from(providers);
      expect(seeded).toHaveLength(SHIPPED_PROVIDER_COUNT);
    },
    MIGRATE_TIMEOUT_MS,
  );

  it(
    "succeeds again on an already migrated database without seeding twice",
    async () => {
      await runMigrate();

      const seeded = await db.select({ slug: providers.slug }).from(providers);
      expect(seeded).toHaveLength(SHIPPED_PROVIDER_COUNT);
    },
    MIGRATE_TIMEOUT_MS,
  );
});
