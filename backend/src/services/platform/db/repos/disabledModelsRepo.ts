import { getAdapter } from "../driver.ts";
import { parseJson, stringifyJson } from "../helpers/jsonCol.ts";

const SCOPE = "disabledModels";

export async function getDisabledModels() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const out: Record<string, any> = {};
  for (const r of rows) out[r.key] = parseJson(r.value, []);
  return out;
}

export async function getDisabledByProvider(providerAlias: any) {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
  return row ? (parseJson(row.value, []) || []) : [];
}

// Atomic read-merge-write inside a transaction (no JS yield mid-transaction).
export async function disableModels(providerAlias: any, ids: any) {
  if (!providerAlias || !Array.isArray(ids)) return;
  const db = await getAdapter();
  db.transaction(() => {
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
    const current = row ? (parseJson(row.value, []) || []) : [];
    const merged = [...new Set([...current, ...ids])];
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, providerAlias, stringifyJson(merged)]
    );
  });
}

export async function enableModels(providerAlias: any, ids: any) {
  if (!providerAlias) return;
  const db = await getAdapter();
  db.transaction(() => {
    if (!Array.isArray(ids) || ids.length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
      return;
    }
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
    const current = row ? (parseJson(row.value, []) || []) : [];
    const removeSet = new Set(ids);
    const next = current.filter((id: any) => !removeSet.has(id));
    if (next.length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
    } else {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [SCOPE, providerAlias, stringifyJson(next)]
      );
    }
  });
}
