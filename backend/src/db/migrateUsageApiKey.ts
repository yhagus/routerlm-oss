// Rewrite usageHistory.apiKey rows that store an apiKeys.id (UUID) into the
// raw key string convention used by v1. v2 wrote the id; v1 wrote the raw key.
// Shared-DB dashboards only see rows whose apiKey matches their own convention,
// so unmigrated v2 rows stay invisible to v1 (and vice-versa).
//
// Usage:
//   bun run src/db/migrateUsageApiKey.ts            # dry-run: report only
//   bun run src/db/migrateUsageApiKey.ts --apply     # rewrite rows
import { Database } from "bun:sqlite";
import { loadRuntimeConfig } from "../config";

void (async () => {
  const config = loadRuntimeConfig();
  const dbPath = config.databasePath;
  if (!dbPath || dbPath === ":memory:") throw new Error("Refusing to run against a memory database");

  const apply = process.argv.includes("--apply");
  const db = new Database(dbPath, { readwrite: true, create: true });
  try {
    db.exec("PRAGMA foreign_keys = ON;");

    const count = (sql: string): number => Number((db.query(sql).get() as { n?: number } | null)?.n ?? 0);
    const affected = count("SELECT COUNT(*) AS n FROM usageHistory WHERE apiKey IN (SELECT id FROM apiKeys)");
    const alreadyRaw = count("SELECT COUNT(*) AS n FROM usageHistory WHERE apiKey IN (SELECT key FROM apiKeys)");
    const orphaned = count("SELECT COUNT(*) AS n FROM usageHistory WHERE apiKey IS NOT NULL AND apiKey NOT IN (SELECT id FROM apiKeys) AND apiKey NOT IN (SELECT key FROM apiKeys)");
    const total = count("SELECT COUNT(*) AS n FROM usageHistory");

    console.log(`Database: ${dbPath}`);
    console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"} (pass --apply to rewrite)`);
    console.log(`Total usageHistory rows: ${total}`);
    console.log(`Rows to migrate (apiKey = apiKeys.id): ${affected}`);
    console.log(`Rows already raw key string (apiKey = apiKeys.key): ${alreadyRaw}`);
    console.log(`Orphaned (non-null, not an id and not a key): ${orphaned}`);

    const sample = db.query("SELECT u.apiKey AS oldId, k.key AS newKey FROM usageHistory u JOIN apiKeys k ON k.id = u.apiKey LIMIT 10").all() as Array<{ oldId: string; newKey: string }>;
    if (sample.length) {
      console.log("Sample mappings (id -> key):");
      for (const row of sample) console.log(`  ${row.oldId} -> ${row.newKey}`);
    }

    if (orphaned > 0) console.log("WARN: orphaned rows cannot be auto-mapped; inspect them manually.");

    if (!apply) {
      console.log("Dry-run only — no rows changed.");
      return;
    }
    if (affected === 0) {
      console.log("Nothing to migrate — no rows changed.");
      return;
    }

    let updated = 0;
    db.transaction(() => {
      const res = db.run("UPDATE usageHistory SET apiKey = (SELECT key FROM apiKeys WHERE id = usageHistory.apiKey) WHERE apiKey IN (SELECT id FROM apiKeys)");
      updated = Number(res.changes);
    })();
    console.log(`Migrated ${updated} rows (id -> raw key string).`);
  } finally {
    db.close();
  }
})();
