import { createHash } from "node:crypto";
import { getAdapterSync } from "../platform/db/driver.ts";

// Free-tier exhaustion is a property of the API key, not of the connection row.
// The store keeps it in the kv table under a hash of the key, so removing and
// re-adding the same key keeps its exhausted models. Nothing here deletes a row
// when a connection goes away.
const SCOPE = "alimsFreeTierExhausted";
const ALL_MODELS = "__all";

export function alimsKeyFingerprint(apiKey: unknown): string | null {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  return key ? createHash("sha256").update(key).digest("hex") : null;
}

function readModels(db: any, fingerprint: string): string[] {
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, fingerprint]);
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeModels(db: any, fingerprint: string, models: string[]): void {
  if (!models.length) {
    db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, fingerprint]);
    return;
  }
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [SCOPE, fingerprint, JSON.stringify(models)],
  );
}

export function markAlimsKeyExhausted(apiKey: unknown, model: string | null | undefined): void {
  const fingerprint = alimsKeyFingerprint(apiKey);
  if (!fingerprint) return;
  const db = getAdapterSync();
  const models = readModels(db, fingerprint);
  const id = model || ALL_MODELS;
  if (!models.includes(id)) writeModels(db, fingerprint, [...models, id]);
}

/** Models marked exhausted for one key. */
export function alimsExhaustedModels(apiKey: unknown): Set<string> {
  const fingerprint = alimsKeyFingerprint(apiKey);
  return fingerprint ? new Set(readModels(getAdapterSync(), fingerprint)) : new Set();
}

export function isAlimsKeyExhausted(apiKey: unknown, model: string | null | undefined): boolean {
  return alimsExhaustedModels(apiKey).has(model || ALL_MODELS);
}

/** Clears one model for one key. Returns true when a marker existed. */
export function clearAlimsKeyExhausted(apiKey: unknown, model: string | null | undefined): boolean {
  const fingerprint = alimsKeyFingerprint(apiKey);
  if (!fingerprint) return false;
  const db = getAdapterSync();
  const models = readModels(db, fingerprint);
  const id = model || ALL_MODELS;
  if (!models.includes(id)) return false;
  writeModels(db, fingerprint, models.filter((entry) => entry !== id));
  return true;
}

/** Operator reset: one model (or all) across every key, including removed keys. Returns affected keys. */
export function resetAlimsExhausted(model: string | null): number {
  const db = getAdapterSync();
  const rows: Array<{ key: string; value: string }> = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  let affected = 0;
  for (const row of rows) {
    const models = readModels(db, row.key);
    const next = model ? models.filter((entry) => entry !== model) : [];
    if (next.length === models.length) continue;
    writeModels(db, row.key, next);
    affected += 1;
  }
  return affected;
}
