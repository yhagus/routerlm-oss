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
      const { databaseUrl, db } = await openPreRenameDatabase();
      const minimax = await insertMiniMaxWithRoute(db, "MiniMax");

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
    const { db } = await openPreRenameDatabase();
    const minimax = await insertMiniMaxWithRoute(db, "MiniMax (team)");

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
  db: Database,
  providerName: string,
): Promise<{ providerId: string; accountId: string; routeId: string }> {
  const [provider] = await db
    .insert(schema.providers)
    .values({
      slug: "minimax",
      name: providerName,
      protocol: "anthropic-messages",
      baseUrl: "https://api.minimax.io/anthropic",
      authStyle: "bearer",
      quirks: { cacheMarkerLimit: 0 },
      isFromCatalog: true,
    })
    .returning();
  if (!provider) throw new Error("the MiniMax Provider was not inserted");

  const [account] = await db
    .insert(schema.providerAccounts)
    .values({
      providerId: provider.id,
      name: "Team key",
      encryptedKey: "not-a-real-ciphertext",
      keyLastFour: "abcd",
    })
    .returning();
  const [upstreamModel] = await db
    .insert(schema.upstreamModels)
    .values({ providerId: provider.id, upstreamModelId: "MiniMax-M3", contextSize: 1000000 })
    .returning();
  const [model] = await db.insert(schema.models).values({ name: "minimax-m3" }).returning();
  if (!account || !upstreamModel || !model)
    throw new Error("the MiniMax fixtures were not inserted");

  const [route] = await db
    .insert(schema.routes)
    .values({ modelId: model.id, upstreamModelId: upstreamModel.id })
    .returning();
  if (!route) throw new Error("the MiniMax Route was not inserted");

  return { providerId: provider.id, accountId: account.id, routeId: route.id };
}
