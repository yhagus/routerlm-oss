import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";

export interface LegacyImportResult {
  sourcePath: string;
  imported: Record<string, number>;
}

const TABLES = [
  "_meta", "settings", "providerConnections", "providerNodes", "proxyPools", "apiKeys", "apiKeyConfig", "combos", "kv",
  "usageHistory", "usageDaily", "requestDetails",
];

function tableExists(database: Database, table: string): boolean {
  return Boolean(database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columns(database: Database, table: string): string[] {
  return (database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

export async function importLegacyDatabase(sourcePath: string, target: Database): Promise<LegacyImportResult> {
  if (!existsSync(sourcePath)) throw new Error(`Legacy database does not exist: ${sourcePath}`);
  const source = new Database(sourcePath, { readonly: true });
  const imported: Record<string, number> = {};
  try {
    target.transaction(() => {
      for (const table of TABLES) {
        if (!tableExists(source, table) || !tableExists(target, table)) continue;
        const sourceColumns = columns(source, table);
        const targetColumns = new Set(columns(target, table));
        const usable = sourceColumns.filter((column) => targetColumns.has(column));
        if (!usable.length) continue;
        const quoted = usable.map((column) => `"${column}"`).join(", ");
        const rows = source.query(`SELECT ${quoted} FROM "${table}"`).all() as Record<string, unknown>[];
        const placeholders = usable.map(() => "?").join(", ");
        const insertMode = table === "settings" || table === "apiKeyConfig" ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
        const insert = target.query(`${insertMode} INTO "${table}" (${quoted}) VALUES (${placeholders})`);
        for (const row of rows) insert.run(...usable.map((column) => row[column]) as any[]);
        imported[table] = rows.length;
      }
    })();
  } finally {
    source.close();
  }
  return { sourcePath, imported };
}
