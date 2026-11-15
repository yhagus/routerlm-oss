import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { type Database, relations } from "@/db/schemas/relations.js";
import { providers } from "@/db/schemas/index.js";
import { createEmptyDatabase, dropDatabase } from "../support/isolated-database.js";

const runFile = promisify(execFile);
// Bun startup plus seeding every shipped Catalog file.
const SEED_TIMEOUT_MS = 30_000;

describe("db:seed script (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let databaseUrl: string;
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, "seed_script");
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle({ client: pool, relations });
    await migrate(db, { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    await pool?.end();
    if (databaseUrl) await dropDatabase(serverUrl, databaseUrl);
  });

  it(
    "seeds a Provider for every Catalog file shipped with the gateway",
    async () => {
      // A DATABASE_URL in the environment wins over the one in the developer's .env.
      await runFile("bun", ["src/seed.ts"], {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: SEED_TIMEOUT_MS,
      });

      const seeded = await db.select({ slug: providers.slug }).from(providers);
      expect(seeded.map((provider) => provider.slug).sort()).toEqual([
        "alibaba-model-studio-intl",
        "anthropic",
        "deepseek",
        "kimi-code",
        "minimax-api",
        "minimax-m-plan",
        "moonshot",
        "openai",
        "xiaomi-mimo",
      ]);
    },
    SEED_TIMEOUT_MS,
  );
});
