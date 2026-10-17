import type { Database, Statement } from "bun:sqlite";

const STATEMENT_METHODS = ["all", "get", "run", "values"] as const;
const MAX_LOGGED_SQL = 300;

export interface SlowQueryLog {
  thresholdMs: number | null;
  count(): number;
}

type Log = (line: string) => void;

function compactSql(sql: string) {
  const text = sql.replace(/\s+/g, " ").trim();
  return text.length > MAX_LOGGED_SQL ? `${text.slice(0, MAX_LOGGED_SQL)}...` : text;
}

// Wraps the SQLite handle so every statement call that runs longer than
// thresholdMs writes one log line. Bound parameters are not logged because
// they can hold credentials. A null threshold leaves the handle unchanged.
export function instrumentSlowQueries(sqlite: Database, thresholdMs: number | null, log: Log = (line) => console.warn(line)): SlowQueryLog {
  let slowCount = 0;
  const result = { thresholdMs, count: () => slowCount };
  if (thresholdMs === null) return result;

  const report = (sql: string, started: number) => {
    const elapsed = performance.now() - started;
    if (elapsed < thresholdMs) return;
    slowCount += 1;
    log(`[SQLite] slow query ${elapsed.toFixed(1)}ms: ${compactSql(sql)}`);
  };

  const wrapped = new WeakSet<object>();
  const wrapStatement = <T extends Statement<any, any>>(statement: T, sql: string): T => {
    if (wrapped.has(statement)) return statement;
    wrapped.add(statement);
    const target = statement as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const method of STATEMENT_METHODS) {
      const original = target[method];
      target[method] = function timed(this: unknown, ...args: unknown[]) {
        const started = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          report(sql, started);
        }
      };
    }
    return statement;
  };

  const handle = sqlite as unknown as Record<string, (...args: any[]) => any>;
  const originalQuery = sqlite.query.bind(sqlite);
  const originalPrepare = sqlite.prepare.bind(sqlite);
  const originalExec = sqlite.exec.bind(sqlite);
  handle.query = (sql: string) => wrapStatement(originalQuery(sql), sql);
  handle.prepare = (sql: string, ...rest: unknown[]) => wrapStatement((originalPrepare as (...args: unknown[]) => Statement)(sql, ...rest), sql);
  const timedExec = (sql: string, ...rest: unknown[]) => {
    const started = performance.now();
    try {
      return (originalExec as (...args: unknown[]) => unknown)(sql, ...rest);
    } finally {
      report(sql, started);
    }
  };
  handle.exec = timedExec;
  handle.run = timedExec;
  return result;
}
