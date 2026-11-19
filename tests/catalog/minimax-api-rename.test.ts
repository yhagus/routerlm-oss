import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { type Database, relations } from "@/db/schemas/relations.js";
import * as schema from "@/db/schemas/index.js";
import { createEmptyDatabase, dropDatabase } from "../support/isolated-database.js";

const runFile = promisify(execFile);
const MIGRATIONS_FOLDER = "./drizzle";
const RENAME_MIGRATION_SUFFIX = "_rename_minimax_to_minimax_api";
// Bun startup plus seeding every shipped Catalog file.
const SEED_TIMEOUT_MS = 30_000;

type PreRenameDatabase = { databaseUrl: string; pool: Pool; db: Database };

describe("MiniMax API rename migration (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let preRenameMigrationsFolder: string;
  const opened: PreRenameDatabase[] = [];

  beforeAll(async () => {
    preRenameMigrationsFolder = await copyMigrationsBeforeRename();
  });

  afterAll(async () => {
    for (const { pool, databaseUrl } of opened) {
      await pool.end();
      await dropDatabase(serverUrl, databaseUrl);
    }
    if (preRenameMigrationsFolder)
      await rm(preRenameMigrationsFolder, { recursive: true, force: true });
  });

  /** A database migrated to the schema before the rename, as an existing install has it. */
  async function openPreRenameDatabase(): Promise<PreRenameDatabase> {
    const databaseUrl = await createEmptyDatabase(serverUrl, "minimax_rename");
    const pool = new Pool({ connectionString: databaseUrl });
    const db = drizzle({ client: pool, relations });
    await migrate(db, { migrationsFolder: preRenameMigrationsFolder });
    const database = { databaseUrl, pool, db };
    opened.push(database);
    return database;
  }

  it(
    "renames the MiniMax Provider in place, keeping its Provider Accounts and Routes, and the seeder adds no duplicate",
    async () => {
      const database = await openPreRenameDatabase();
      const { databaseUrl, db } = database;
      const minimax = await insertMiniMaxWithRoute(database, "MiniMax");

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      await runFile("bun", ["src/seed.ts"], {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: SEED_TIMEOUT_MS,
      });

      const provider = await db.query.providers.findFirst({
        where: { id: minimax.providerId },
        with: {
          providerAccounts: true,
          upstreamModels: { where: { upstreamModelId: "MiniMax-M3" }, with: { routes: true } },
        },
      });
      expect(provider).toMatchObject({ slug: "minimax-api", name: "MiniMax API" });
      expect(provider?.providerAccounts.map((account) => account.id)).toEqual([minimax.accountId]);
      expect(provider?.upstreamModels[0]?.routes.map((route) => route.id)).toEqual([
        minimax.routeId,
      ]);

      const minimaxProviders = await db
        .select({ id: schema.providers.id, slug: schema.providers.slug })
        .from(schema.providers)
        .where(like(schema.providers.slug, "minimax%"));
      expect(minimaxProviders.map((row) => row.slug).sort()).toEqual([
        "minimax-api",
        "minimax-m-plan",
      ]);
    },
    SEED_TIMEOUT_MS,
  );

  it("keeps the name an operator gave the Provider and changes only its slug", async () => {
    const database = await openPreRenameDatabase();
    const { db } = database;
    const minimax = await insertMiniMaxWithRoute(database, "MiniMax (team)");

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const provider = await db.query.providers.findFirst({ where: { id: minimax.providerId } });
    expect(provider).toMatchObject({ slug: "minimax-api", name: "MiniMax (team)" });
  });
});

/** Copies every migration that precedes the rename into a temporary folder. */
async function copyMigrationsBeforeRename(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "routerlm-migrations-"));
  const migrationNames = (await readdir(MIGRATIONS_FOLDER)).sort();
  const renameIndex = migrationNames.findIndex((name) => name.endsWith(RENAME_MIGRATION_SUFFIX));
  if (renameIndex === -1) {
    throw new Error(`no migration ending in ${RENAME_MIGRATION_SUFFIX} in ${MIGRATIONS_FOLDER}`);
  }
  for (const name of migrationNames.slice(0, renameIndex)) {
    await cp(join(MIGRATIONS_FOLDER, name), join(folder, name), { recursive: true });
  }
  return folder;
}

/** The MiniMax Provider as the seeder created it before the rename, in use by one Route. */
async function insertMiniMaxWithRoute(
  { pool }: PreRenameDatabase,
  providerName: string,
): Promise<{ providerId: string; accountId: string; routeId: string }> {
  // Plain SQL: Drizzle names every column of today's schema in an insert,
  // and later migrations add columns this database doesn't have yet.
  const providerId = await insertReturningId(
    pool,
    `insert into providers (slug, name, protocol, base_url, auth_style, quirks, is_from_catalog)
     values ('minimax', $1, 'anthropic-messages', 'https://api.minimax.io/anthropic', 'bearer',
             '{"cacheMarkerLimit":0}', true)
     returning id`,
    [providerName],
  );
  const accountId = await insertReturningId(
    pool,
    `insert into provider_accounts (provider_id, name, encrypted_key, key_last_four)
     values ($1, 'Team key', 'not-a-real-ciphertext', 'abcd')
     returning id`,
    [providerId],
  );
  const upstreamModelId = await insertReturningId(
    pool,
    `insert into upstream_models (provider_id, upstream_model_id, context_size)
     values ($1, 'MiniMax-M3', 1000000)
     returning id`,
    [providerId],
  );
  const modelId = await insertReturningId(
    pool,
    `insert into models (name) values ('minimax-m3') returning id`,
    [],
  );
  const routeId = await insertReturningId(
    pool,
    `insert into routes (model_id, upstream_model_id) values ($1, $2) returning id`,
    [modelId, upstreamModelId],
  );

  return { providerId, accountId, routeId };
}

async function insertReturningId(pool: Pool, insert: string, values: string[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(insert, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("the row was not inserted");
  return id;
}
