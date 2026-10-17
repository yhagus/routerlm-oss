import { getAdapter } from "../driver.ts";

export async function getMeta(key: any, fallback: any = null) {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM _meta WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}

export async function setMeta(key: any, value: any) {
  const db = await getAdapter();
  db.run(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
}

// Sync versions for use during migration (adapter passed directly)
export function getMetaSync(adapter: any, key: any, fallback: any = null) {
  const row = adapter.get(`SELECT value FROM _meta WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}

export function setMetaSync(adapter: any, key: any, value: any) {
  adapter.run(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
}
