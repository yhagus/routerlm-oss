import { getAdapter } from "../driver.ts";
import { parseJson, stringifyJson } from "../helpers/jsonCol.ts";

const SCOPE = "modelContextWindows";
const MAX_CONTEXT_WINDOW = 2_000_000;

/** Positive integer token ceiling, or null when invalid. */
export function normalizeContextWindow(value: any) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.min(Math.floor(number), MAX_CONTEXT_WINDOW);
}

/** All overrides as { "provider/model": window } (undefined value = unset). */
export async function getModelContextWindows() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const out: Record<string, any> = {};
  for (const r of rows) {
    const window = normalizeContextWindow(parseJson(r.value, null));
    if (window !== null) out[r.key] = window;
  }
  return out;
}

/** Single override for provider/model, or null when unset/invalid. */
export async function getModelContextWindow(provider: any, model: any) {
  if (!provider || !model) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [
    SCOPE,
    `${provider}/${model}`,
  ]);
  return row ? normalizeContextWindow(parseJson(row.value, null)) : null;
}

/** Upsert an override; contextWindow of 0/null removes it. */
export async function setModelContextWindow(provider: any, model: any, contextWindow: any) {
  if (!provider || !model) throw new Error("provider and model are required");
  const window = normalizeContextWindow(contextWindow);
  if (window === null) throw new Error("contextWindow must be a positive integer");

  const db = await getAdapter();
  const key = `${provider}/${model}`;
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [SCOPE, key, stringifyJson(window)],
  );
  return window;
}

export async function deleteModelContextWindow(provider: any, model: any) {
  if (!provider || !model) return;
  const db = await getAdapter();
  db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [
    SCOPE,
    `${provider}/${model}`,
  ]);
}
