import { cp, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MIGRATIONS_FOLDER = './drizzle';

export async function copyMigrationsBefore(migrationSuffix: string): Promise<string> {
  const migrationNames = (await readdir(MIGRATIONS_FOLDER)).sort();
  const migrationIndex = migrationNames.findIndex((name) => name.endsWith(migrationSuffix));
  if (migrationIndex === -1) {
    throw new Error(`no migration ending in ${migrationSuffix} in ${MIGRATIONS_FOLDER}`);
  }
  const folder = await mkdtemp(join(tmpdir(), 'routerlm-migrations-'));
  for (const name of migrationNames.slice(0, migrationIndex)) {
    await cp(join(MIGRATIONS_FOLDER, name), join(folder, name), { recursive: true });
  }
  return folder;
}
