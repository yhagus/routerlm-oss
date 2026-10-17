import { getAdapter } from "../driver.ts";
import { parseJson, stringifyJson } from "./jsonCol.ts";

export function makeKv(scope: any) {
  return {
    async get(key: any, fallback: any = null) {
      const db = await getAdapter();
      const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
      return row ? parseJson(row.value, fallback) : fallback;
    },
    async getAll() {
      const db = await getAdapter();
      const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [scope]);
      const out: Record<string, any> = {};
      for (const r of rows) out[r.key] = parseJson(r.value);
      return out;
    },
    async set(key: any, value: any) {
      const db = await getAdapter();
      db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`, [scope, key, stringifyJson(value)]);
    },
    async setMany(obj: any) {
      const db = await getAdapter();
      db.transaction(() => {
        for (const [k, v] of Object.entries(obj as Record<string, any>)) {
          db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`, [scope, k, stringifyJson(v)]);
        }
      });
    },
    async remove(key: any) {
      const db = await getAdapter();
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
    },
    async clear() {
      const db = await getAdapter();
      db.run(`DELETE FROM kv WHERE scope = ?`, [scope]);
    },
  };
}
