import { randomUUID } from "node:crypto";
import { Client } from "pg";

/**
 * Creates an empty database named `<prefix>_<random>` on the server
 * `serverUrl` points at, so parallel runs never see each other's rows.
 * Returns its URL.
 */
export async function createEmptyDatabase(serverUrl: string, prefix: string): Promise<string> {
  const name = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function dropDatabase(serverUrl: string, databaseUrl: string): Promise<void> {
  const name = new URL(databaseUrl).pathname.slice(1);
  const admin = new Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
