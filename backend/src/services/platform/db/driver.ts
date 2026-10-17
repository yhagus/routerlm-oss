// The legacy platform repos read and write through the SQLite handle that
// createRuntime() opens (BACKEND_DATABASE_PATH). This module never opens a
// database file and never runs migrations: src/db/migrate.ts owns the schema.
import type { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "./adapters/bunSqliteAdapter.ts";

type LegacyAdapter = ReturnType<typeof createBunSqliteAdapter>;

let bound: LegacyAdapter | null = null;

// Called by createRuntime(). The newest runtime wins, as in tests that create
// runtimes one after another.
export function bindLegacyDatabase(sqlite: Database): void {
  bound?.release();
  bound = createBunSqliteAdapter(sqlite);
}

// Called by runtime.close() before the handle closes. A stale runtime does not
// unbind a newer one.
export function releaseLegacyDatabase(sqlite: Database): void {
  if (bound?.raw !== sqlite) return;
  bound.release();
  bound = null;
}

// Typed as any: the legacy repos are untyped JS ports.
export function getAdapterSync(): any {
  if (!bound) throw new Error("[DB] no runtime database is bound; call createRuntime() first");
  return bound;
}

export async function getAdapter(): Promise<any> {
  return getAdapterSync();
}
