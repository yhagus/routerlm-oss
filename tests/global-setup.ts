import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export default async function setup(): Promise<void> {
  const databaseUrl = new URL(requireTestDatabaseUrl());
  const databaseName = databaseUrl.pathname.slice(1);

  const serverUrl = new URL(databaseUrl);
  serverUrl.pathname = "/postgres";
  const server = new pg.Client({ connectionString: serverUrl.toString() });
  await server.connect();
  try {
    const existing = await server.query("select 1 from pg_database where datname = $1", [
      databaseName,
    ]);
    if (existing.rowCount === 0) {
      await server.query(`create database ${pg.escapeIdentifier(databaseName)}`);
    }
  } finally {
    await server.end();
  }

  const db = drizzle({ connection: databaseUrl.toString() });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    await db.$client.end();
  }
}

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set; vitest.config.ts defaults it");
  }
  return url;
}
