import type { Database } from "bun:sqlite";
import { deriveUsageFacts } from "./usageQueries";

// Keep the physical database compatible with the legacy application. Do not
// introduce a v2-normalized schema here: v2 opens DATA_DIR/db/data.sqlite.
const LEGACY_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL, authType TEXT NOT NULL, name TEXT, email TEXT, priority INTEGER, isActive INTEGER DEFAULT 1, data TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider);
CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive);
CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority);
CREATE TABLE IF NOT EXISTS providerNodes (id TEXT PRIMARY KEY, type TEXT, name TEXT, data TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type);
CREATE TABLE IF NOT EXISTS proxyPools (id TEXT PRIMARY KEY, isActive INTEGER DEFAULT 1, testStatus TEXT, data TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive);
CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus);
CREATE TABLE IF NOT EXISTS apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, comboAccessMode TEXT DEFAULT 'blacklist', comboAccessList TEXT DEFAULT '[]', modelAccessMode TEXT DEFAULT 'whitelist', modelAccessList TEXT DEFAULT '[]', visibility TEXT DEFAULT 'private', isDefault INTEGER DEFAULT 0, limitMode TEXT DEFAULT 'none', limitValue INTEGER, maxConcurrency INTEGER, connectionPins TEXT DEFAULT '{}', usageRequests INTEGER DEFAULT 0, usageTokens INTEGER DEFAULT 0, features TEXT DEFAULT '{}', parentId TEXT, createdAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key);
CREATE INDEX IF NOT EXISTS idx_ak_parent ON apiKeys(parentId);
CREATE TABLE IF NOT EXISTS apiKeyConfig (id INTEGER PRIMARY KEY CHECK (id = 1), prefix TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS combos (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, kind TEXT, models TEXT NOT NULL, identityEnabled INTEGER DEFAULT 0, accountFilters TEXT DEFAULT '{}', useCustomAccountOrder INTEGER DEFAULT 0, capabilities TEXT DEFAULT '{}', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name);
CREATE TABLE IF NOT EXISTS kv (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (scope, key));
CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope);
CREATE TABLE IF NOT EXISTS usageHistory (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, provider TEXT, model TEXT, connectionId TEXT, apiKey TEXT, endpoint TEXT, clientIp TEXT, promptTokens INTEGER DEFAULT 0, completionTokens INTEGER DEFAULT 0, cost REAL DEFAULT 0, status TEXT, tokens TEXT, meta TEXT, cachedTokens INTEGER, comboName TEXT, failed INTEGER, successTps REAL, successLatencyMs REAL);
CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider);
CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model);
CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId);
CREATE INDEX IF NOT EXISTS idx_uh_provider_conn_ts ON usageHistory(provider, connectionId, timestamp);
CREATE INDEX IF NOT EXISTS idx_uh_apikey_ts ON usageHistory(apiKey, timestamp);
CREATE INDEX IF NOT EXISTS idx_uh_underived ON usageHistory(id) WHERE cachedTokens IS NULL;
CREATE TABLE IF NOT EXISTS usageDaily (dateKey TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usageDailyRollup (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, provider TEXT, model TEXT, connectionId TEXT, apiKey TEXT, comboName TEXT, clientIp TEXT, requests INTEGER NOT NULL DEFAULT 0, promptTokens INTEGER NOT NULL DEFAULT 0, completionTokens INTEGER NOT NULL DEFAULT 0, cachedTokens INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, tpsSum REAL NOT NULL DEFAULT 0, tpsCount INTEGER NOT NULL DEFAULT 0, latencyMsSum REAL NOT NULL DEFAULT 0, latencyCount INTEGER NOT NULL DEFAULT 0, firstAt TEXT NOT NULL, lastAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_udr_group ON usageDailyRollup(day, provider, model, connectionId, apiKey, comboName, clientIp);
CREATE INDEX IF NOT EXISTS idx_udr_last ON usageDailyRollup(lastAt);
CREATE TABLE IF NOT EXISTS requestDetails (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, provider TEXT, model TEXT, connectionId TEXT, status TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider);
CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model);
CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId);
CREATE TABLE IF NOT EXISTS quotaSnapshots (connectionId TEXT PRIMARY KEY REFERENCES providerConnections(id) ON DELETE CASCADE, provider TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', fetchedAt TEXT, expiresAt TEXT, nextRefreshAt TEXT, lastError TEXT, failureCount INTEGER NOT NULL DEFAULT 0, updatedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_qs_refresh ON quotaSnapshots(nextRefreshAt);
CREATE TABLE IF NOT EXISTS autoclawTasks (connectionId TEXT NOT NULL, taskId TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL, rewardPoints INTEGER NOT NULL DEFAULT 0, alreadyCompleted INTEGER NOT NULL DEFAULT 0, error TEXT, payload TEXT NOT NULL DEFAULT '{}', updatedAt TEXT NOT NULL, PRIMARY KEY (connectionId, taskId, day));
CREATE INDEX IF NOT EXISTS idx_act_conn_day ON autoclawTasks(connectionId, day);
CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, provider TEXT NOT NULL, providerAlias TEXT NOT NULL, modelId TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'llm', source TEXT NOT NULL, disabled INTEGER DEFAULT 0, upstreamModelId TEXT, quotaFamily TEXT, contextLength INTEGER, contextWindowOverride INTEGER, capabilities TEXT DEFAULT '{}', sortOrder INTEGER DEFAULT 999, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider);
CREATE INDEX IF NOT EXISTS idx_models_kind ON models(kind);
CREATE INDEX IF NOT EXISTS idx_models_name ON models(name);
CREATE INDEX IF NOT EXISTS idx_models_source ON models(source);
CREATE TABLE IF NOT EXISTS quotaWindows (connectionId TEXT NOT NULL REFERENCES providerConnections(id) ON DELETE CASCADE, mode TEXT NOT NULL, remaining INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, usagePercent REAL NOT NULL DEFAULT 0, breakdown TEXT NOT NULL DEFAULT '[]', windowSeconds INTEGER NOT NULL DEFAULT 0, resetAt TEXT, syncedAt TEXT, source TEXT NOT NULL DEFAULT 'default', updatedAt TEXT NOT NULL, PRIMARY KEY (connectionId, mode));
CREATE INDEX IF NOT EXISTS idx_qw_conn ON quotaWindows(connectionId);
CREATE INDEX IF NOT EXISTS idx_qw_reset ON quotaWindows(resetAt);
CREATE TABLE IF NOT EXISTS quotaRecovery (id TEXT PRIMARY KEY, connectionId TEXT NOT NULL REFERENCES providerConnections(id) ON DELETE CASCADE, mode TEXT NOT NULL, dueAt TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, claimToken TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_qr_conn ON quotaRecovery(connectionId);
CREATE INDEX IF NOT EXISTS idx_qr_due ON quotaRecovery(dueAt);
CREATE TABLE IF NOT EXISTS rateLimitEvents (id INTEGER PRIMARY KEY AUTOINCREMENT, connectionId TEXT NOT NULL REFERENCES providerConnections(id) ON DELETE CASCADE, mode TEXT, statusCode INTEGER NOT NULL, retryAfter INTEGER, resetAt TEXT, message TEXT, createdAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rle_conn ON rateLimitEvents(connectionId);
CREATE INDEX IF NOT EXISTS idx_rle_ts ON rateLimitEvents(createdAt DESC);
CREATE TABLE IF NOT EXISTS connectionTestJobs (id TEXT PRIMARY KEY, providerId TEXT NOT NULL, status TEXT NOT NULL, delayMs INTEGER NOT NULL DEFAULT 1000, total INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, passed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, currentConnectionId TEXT, error TEXT, createdAt TEXT NOT NULL, startedAt TEXT, finishedAt TEXT, updatedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ctj_provider ON connectionTestJobs(providerId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_ctj_status ON connectionTestJobs(status);
CREATE TABLE IF NOT EXISTS connectionTestJobItems (id TEXT PRIMARY KEY, jobId TEXT NOT NULL REFERENCES connectionTestJobs(id) ON DELETE CASCADE, connectionId TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, latencyMs INTEGER, testedAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ctji_job ON connectionTestJobItems(jobId, position);
CREATE TABLE IF NOT EXISTS visionAdapters (id TEXT PRIMARY KEY, name TEXT NOT NULL, models TEXT NOT NULL, isGlobal INTEGER DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_va_name ON visionAdapters(name);
`;

// Split a column list on top-level commas (ignore commas inside parentheses).
function splitColumnList(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// Additive sync: add each column that LEGACY_SCHEMA declares but an older
// database file lacks. This replaces the removed platform/db auto-sync.
function addMissingColumns(sqlite: Database): Set<string> {
  const added = new Set<string>();
  for (const match of LEGACY_SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \((.*)\);$/gm)) {
    const [, table, body] = match;
    const existing = new Set((sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
    for (const definition of splitColumnList(body)) {
      if (/^(PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK|CONSTRAINT)\b/i.test(definition)) continue;
      const [name] = definition.split(/\s+/, 1);
      if (existing.has(name)) continue;
      const safe = definition.replace(/PRIMARY KEY( AUTOINCREMENT)?/i, "").replace(/\bUNIQUE\b/i, "").trim();
      try {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${safe}`);
        added.add(`${table}.${name}`);
      } catch (error) {
        console.warn(`[DB][sync] add column ${table}.${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return added;
}

// Fill the API key lifetime counters from usageHistory when the counter
// columns are new. Existing counters stay as they are.
function backfillApiKeyUsageCounters(sqlite: Database): void {
  sqlite.exec(`UPDATE apiKeys SET
    usageRequests = COALESCE((SELECT COUNT(*) FROM usageHistory WHERE usageHistory.apiKey = apiKeys.key), 0),
    usageTokens = COALESCE((SELECT COALESCE(SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 0) FROM usageHistory WHERE usageHistory.apiKey = apiKeys.key), 0)`);
}

export function applyMigrations(sqlite: Database): void {
  // Tables first, then missing columns, then indexes. An index on a column
  // that an older file lacks would fail before the column sync.
  const lines = LEGACY_SCHEMA.split("\n").filter((line) => line.trim());
  const isIndex = (line: string) => /^CREATE (UNIQUE )?INDEX/.test(line);
  sqlite.exec(lines.filter((line) => !isIndex(line)).join("\n"));
  const addedColumns = addMissingColumns(sqlite);
  sqlite.exec(lines.filter(isIndex).join("\n"));
  if (addedColumns.has("apiKeys.usageRequests")) backfillApiKeyUsageCounters(sqlite);
  // Rows from older builds lack the derived Usage facts that SQL aggregation reads.
  deriveUsageFacts(sqlite);
  const comboColumns = sqlite.query("PRAGMA table_info(combos)").all() as Array<{ name: string }>;
  if (!comboColumns.some((column) => column.name === "capabilities")) {
    sqlite.exec("ALTER TABLE combos ADD COLUMN capabilities TEXT DEFAULT '{}'");
  }
  const autoclawColumns = sqlite.query("PRAGMA table_info(autoclawTasks)").all() as Array<{ name: string }>;
  if (!autoclawColumns.some((column) => column.name === "payload")) {
    sqlite.exec("ALTER TABLE autoclawTasks ADD COLUMN payload TEXT NOT NULL DEFAULT '{}'");
  }
  // "event" API keys carry a concurrency cap and per-combo-model connection
  // pins. Add the columns to existing databases.
  const apiKeyColumns = sqlite.query("PRAGMA table_info(apiKeys)").all() as Array<{ name: string }>;
  if (!apiKeyColumns.some((column) => column.name === "maxConcurrency")) {
    sqlite.exec("ALTER TABLE apiKeys ADD COLUMN maxConcurrency INTEGER");
  }
  if (!apiKeyColumns.some((column) => column.name === "connectionPins")) {
    sqlite.exec("ALTER TABLE apiKeys ADD COLUMN connectionPins TEXT DEFAULT '{}'");
  }
  // Schema 22 turns "event" keys into secretless parents of participant keys.
  // Pre-22 event keys hold a working secret, so they become private keys.
  const version = sqlite.query("SELECT value FROM _meta WHERE key = 'schemaVersion'").get() as { value?: string } | null;
  if (version && Number(version.value) < 22) {
    sqlite.exec("UPDATE apiKeys SET visibility = 'private' WHERE visibility = 'event'");
  }
  sqlite.query("INSERT OR IGNORE INTO settings (id, data) VALUES (1, ?)").run(JSON.stringify({ requireLogin: true, requireApiKey: false }));
  sqlite.query("INSERT OR IGNORE INTO apiKeyConfig (id, prefix) VALUES (1, 'sk-')").run();
  sqlite.query("INSERT OR REPLACE INTO _meta (key, value) VALUES ('schemaVersion', '22')").run();
}
