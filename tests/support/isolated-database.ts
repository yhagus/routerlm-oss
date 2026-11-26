import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

export async function createEmptyDatabase(
  serverUrl: string,
  prefix: string,
  suffix = '',
): Promise<string> {
  const name = `${prefix}_${randomUUID().replaceAll('-', '')}${suffix}`;
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
