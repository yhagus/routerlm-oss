// Wraps the runtime-owned bun:sqlite handle in the legacy adapter interface.
// The adapter never opens, checkpoints, or closes the database. The runtime
// owns the connection lifecycle and main.ts owns the shutdown signals.
import type { Database } from "bun:sqlite";

export function createBunSqliteAdapter(db: Database) {
  const stmtCache = new Map<string, any>();
  function prepare(sql: any) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  return {
    driver: "bun:sqlite",
    run(sql: any, params: any[] = []) {
      const r = prepare(sql).run(...params);
      return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
    get(sql: any, params: any[] = []): any {
      return prepare(sql).get(...params);
    },
    all(sql: any, params: any[] = []): any[] {
      return prepare(sql).all(...params);
    },
    exec(sql: any) { return db.exec(sql); },
    transaction(fn: any): any {
      const tx = db.transaction(fn);
      return tx();
    },
    // Drops cached statements. The runtime closes the handle itself.
    release() {
      for (const stmt of stmtCache.values()) {
        try { stmt.finalize(); } catch {}
      }
      stmtCache.clear();
    },
    raw: db,
  };
}
