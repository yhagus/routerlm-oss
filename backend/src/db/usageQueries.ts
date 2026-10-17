import type { Database } from "bun:sqlite";

// SQL read layer for usageHistory. Dashboard totals and series come from
// GROUP BY queries here, so no endpoint loads every raw Usage row into
// JavaScript.
//
// Each row stores derived facts next to the raw JSON: canonical prompt and
// completion counts, cached tokens, combo name, a failed flag, and the tokens
// per second and latency of a successful request. Aggregates read these plain
// columns because JSON parsing and status checks per row block the event loop
// on large tables. usage.record writes the facts. deriveUsageFacts fills rows
// that other writers stored without them. A NULL cachedTokens marks such a row.

function numberValue(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return {}; }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

export function usageTokenCounts(row: Record<string, unknown>): { promptTokens: number; completionTokens: number; cachedTokens: number } {
  const tokens = objectValue(row.tokens);
  // Canonical rows (written by usage.record) carry cached tokens at top level.
  // The nested fallbacks only defend against pre-canonicalization rows so
  // legacy data still reads correctly. prompt_tokens is cache-inclusive.
  const cachedTokens = numberValue(
    tokens.cached_tokens ??
    tokens.cache_read_input_tokens ??
    (tokens.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens ??
    (tokens.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens,
  );
  return {
    promptTokens: numberValue(tokens.prompt_tokens ?? tokens.input_tokens ?? row.prompt_tokens),
    completionTokens: numberValue(tokens.completion_tokens ?? tokens.output_tokens ?? row.completion_tokens),
    cachedTokens,
  };
}

export interface UsageFacts {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  comboName: string;
  // 1 unless the status is empty, "ok" or "success" (any case).
  failed: 0 | 1;
  // Set only for a successful request with a positive value, else null.
  successTps: number | null;
  successLatencyMs: number | null;
}

export function isSuccessStatus(status: unknown): boolean {
  if (status == null) return true;
  const value = String(status).toLowerCase();
  return value === "" || value === "ok" || value === "success";
}

// Facts for one row. `row` uses the raw column values: tokens and meta as JSON
// text or objects, prompt_tokens and completion_tokens as the stored counts,
// and status.
export function usageFacts(row: Record<string, unknown>): UsageFacts {
  const meta = objectValue(row.meta);
  const success = isSuccessStatus(row.status);
  const tps = numberValue(meta.tokensPerSecond);
  const latency = numberValue(meta.totalMs);
  return {
    ...usageTokenCounts(row),
    comboName: meta.comboName ? String(meta.comboName).trim() : "",
    failed: success ? 0 : 1,
    successTps: success && tps > 0 ? tps : null,
    successLatencyMs: success && latency > 0 ? latency : null,
  };
}

const DERIVE_BATCH = 2000;

// Fills the derived facts for rows that lack them. Returns the row count.
// A partial index keeps the check cheap when every row is already derived.
export function deriveUsageFacts(sqlite: Database): number {
  const select = sqlite.query("SELECT id, status, tokens, meta, promptTokens AS prompt_tokens, completionTokens AS completion_tokens FROM usageHistory WHERE cachedTokens IS NULL LIMIT ?");
  const update = sqlite.query("UPDATE usageHistory SET promptTokens = ?, completionTokens = ?, cachedTokens = ?, comboName = ?, failed = ?, successTps = ?, successLatencyMs = ? WHERE id = ?");
  let total = 0;
  while (true) {
    const rows = select.all(DERIVE_BATCH) as Array<Record<string, unknown>>;
    if (!rows.length) return total;
    sqlite.transaction(() => {
      for (const row of rows) {
        const facts = usageFacts(row);
        update.run(facts.promptTokens, facts.completionTokens, facts.cachedTokens, facts.comboName, facts.failed, facts.successTps, facts.successLatencyMs, row.id as number);
      }
    })();
    total += rows.length;
  }
}

export type UsageDimension = "provider" | "model" | "connectionId" | "apiKey" | "comboName" | "clientIp";

const DIMENSION_SQL: Record<UsageDimension, string> = {
  provider: "provider",
  model: "model",
  connectionId: "connectionId",
  apiKey: "apiKey",
  comboName: "comboName",
  // Blank addresses group under NULL, like the JavaScript trim check.
  clientIp: "NULLIF(TRIM(clientIp, ' ' || char(9, 10, 11, 12, 13)), '')",
};

// Row filter. `since` is inclusive and `before` is exclusive (ISO timestamps).
// `provider: null` selects rows without a Provider.
export interface UsageScope {
  since?: string | null;
  before?: string | null;
  provider?: string | null;
  connectionId?: string;
  apiKey?: string;
}

export interface UsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  failed: number;
  tpsSum: number;
  tpsCount: number;
  latencyMsSum: number;
  latencyCount: number;
  lastUsed: string | null;
}

export interface UsageGroup extends UsageTotals {
  keys: Partial<Record<UsageDimension, string | null>>;
  // Index into the `buckets` option, or null without buckets.
  bucket: number | null;
}

function scopeSql(scope: UsageScope, time = true, timeColumn = "timestamp"): { where: string[]; values: Array<string | number> } {
  const where: string[] = [];
  const values: Array<string | number> = [];
  if (time && scope.since) { where.push(`${timeColumn} >= ?`); values.push(scope.since); }
  if (time && scope.before) { where.push(`${timeColumn} < ?`); values.push(scope.before); }
  if (scope.provider === null) where.push("provider IS NULL");
  else if (scope.provider !== undefined) { where.push("provider = ?"); values.push(scope.provider); }
  if (scope.connectionId !== undefined) { where.push("connectionId = ?"); values.push(scope.connectionId); }
  if (scope.apiKey !== undefined) { where.push("apiKey = ?"); values.push(scope.apiKey); }
  return { where, values };
}

// Without table statistics SQLite prefers to scan the whole provider index to
// skip a GROUP BY sort, even when a time range selects few rows. A time-bound
// query without an equality filter therefore reads the timestamp index.
function timeIndexHint(scope: UsageScope, timeBound: boolean): string {
  const equality = scope.provider !== undefined || scope.connectionId !== undefined || scope.apiKey !== undefined;
  return timeBound && !equality ? " INDEXED BY idx_uh_ts" : "";
}

const TOTALS_SQL = `COUNT(*) AS requests,
  COALESCE(SUM(promptTokens), 0) AS promptTokens,
  COALESCE(SUM(completionTokens), 0) AS completionTokens,
  COALESCE(SUM(cachedTokens), 0) AS cachedTokens,
  COALESCE(SUM(cost), 0) AS cost,
  COALESCE(SUM(failed), 0) AS failed,
  COALESCE(SUM(successTps), 0) AS tpsSum,
  COUNT(successTps) AS tpsCount,
  COALESCE(SUM(successLatencyMs), 0) AS latencyMsSum,
  COUNT(successLatencyMs) AS latencyCount,
  MAX(timestamp) AS lastUsed`;

function totalsOf(row: Record<string, unknown>): UsageTotals {
  return {
    requests: numberValue(row.requests),
    promptTokens: numberValue(row.promptTokens),
    completionTokens: numberValue(row.completionTokens),
    cachedTokens: numberValue(row.cachedTokens),
    cost: numberValue(row.cost),
    failed: numberValue(row.failed),
    tpsSum: numberValue(row.tpsSum),
    tpsCount: numberValue(row.tpsCount),
    latencyMsSum: numberValue(row.latencyMsSum),
    latencyCount: numberValue(row.latencyCount),
    lastUsed: row.lastUsed == null ? null : String(row.lastUsed),
  };
}

// Daily rollups (usageDailyRollup) hold the rows that the retention job moved
// out of usageHistory. One rollup row sums the requests of one local day for
// one set of dimension values. The day is the server's local calendar day,
// because the dashboard slots are local days. `firstAt` and `lastAt` keep the
// oldest and newest request time of the row. Reads place a rollup row by its
// `lastAt`: a time range or bucket that holds `lastAt` takes the whole row.
// The retention cutoff is a local midnight, and the day periods start at a
// local midnight, so those ranges never split a rolled-up day. Integer totals
// stay exact. Real sums (cost, tokens per second, latency) add in a different
// order, so they can differ in the last floating-point digit.
const ROLLUP_TOTALS_SQL = `COALESCE(SUM(requests), 0) AS requests,
  COALESCE(SUM(promptTokens), 0) AS promptTokens,
  COALESCE(SUM(completionTokens), 0) AS completionTokens,
  COALESCE(SUM(cachedTokens), 0) AS cachedTokens,
  COALESCE(SUM(cost), 0) AS cost,
  COALESCE(SUM(failed), 0) AS failed,
  COALESCE(SUM(tpsSum), 0) AS tpsSum,
  COALESCE(SUM(tpsCount), 0) AS tpsCount,
  COALESCE(SUM(latencyMsSum), 0) AS latencyMsSum,
  COALESCE(SUM(latencyCount), 0) AS latencyCount,
  MAX(lastAt) AS lastUsed`;

interface UsageSource {
  table: string;
  time: string;
  totals: string;
  dimension(dimension: UsageDimension): string;
  hint(scope: UsageScope, timeBound: boolean): string;
}

const RAW_SOURCE: UsageSource = { table: "usageHistory", time: "timestamp", totals: TOTALS_SQL, dimension: (dimension) => DIMENSION_SQL[dimension], hint: timeIndexHint };
// Rollups store clientIp already trimmed, with NULL for a blank address.
const ROLLUP_SOURCE: UsageSource = { table: "usageDailyRollup", time: "lastAt", totals: ROLLUP_TOTALS_SQL, dimension: (dimension) => dimension, hint: () => "" };

function aggregateSource(sqlite: Database, source: UsageSource, scope: UsageScope, by: UsageDimension[], buckets: Array<[string, string]> | undefined): UsageGroup[] {
  // Buckets carry the time range themselves: they are clipped to `since` and `before`.
  const { where, values } = scopeSql(scope, !buckets, source.time);
  const columns = by.map((dimension, index) => `${source.dimension(dimension)} AS k${index}`);
  const groups = by.map((_, index) => `k${index}`);
  let from = `${source.table}${source.hint(scope, Boolean(scope.since || scope.before))}`;
  const params: Array<string | number> = [];
  if (buckets) {
    const ranges = buckets.map(([start, end]): [string, string] => [
      scope.since && scope.since > start ? scope.since : start,
      scope.before && scope.before < end ? scope.before : end,
    ]);
    if (!ranges.length) return [];
    from = `json_each(?) AS bucket JOIN ${source.table}${source.hint(scope, true)} ON ${source.table}.${source.time} >= bucket.value ->> 0 AND ${source.table}.${source.time} < bucket.value ->> 1`;
    params.push(JSON.stringify(ranges));
    columns.unshift("bucket.key AS bucket");
    groups.unshift("bucket.key");
  }
  const sql = `SELECT ${[...columns, source.totals].join(", ")} FROM ${from}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${groups.length ? ` GROUP BY ${groups.join(", ")}` : ""} ORDER BY lastUsed DESC`;
  const rows = sqlite.query(sql).all(...params, ...values) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const keys: Partial<Record<UsageDimension, string | null>> = {};
    by.forEach((dimension, index) => { const value = row[`k${index}`]; keys[dimension] = value == null ? null : String(value); });
    return { ...totalsOf(row), keys, bucket: buckets ? numberValue(row.bucket) : null };
  });
}

// Newest first, NULL last, like SQLite's ORDER BY lastUsed DESC.
function newerFirst(left: { lastUsed: string | null }, right: { lastUsed: string | null }): number {
  if (left.lastUsed === right.lastUsed) return 0;
  if (left.lastUsed === null) return 1;
  if (right.lastUsed === null) return -1;
  return left.lastUsed > right.lastUsed ? -1 : 1;
}

function laterOf(left: string | null, right: string | null): string | null {
  return left === null || (right !== null && right > left) ? right : left;
}

// Adds rollup groups into raw groups with the same bucket and keys.
function mergeGroups(raw: UsageGroup[], rolled: UsageGroup[], by: UsageDimension[]): UsageGroup[] {
  if (!rolled.length) return raw;
  const merged = new Map<string, UsageGroup>();
  for (const group of [...raw, ...rolled]) {
    const key = JSON.stringify([group.bucket, by.map((dimension) => group.keys[dimension] ?? null)]);
    const current = merged.get(key);
    if (!current) { merged.set(key, { ...group }); continue; }
    current.requests += group.requests;
    current.promptTokens += group.promptTokens;
    current.completionTokens += group.completionTokens;
    current.cachedTokens += group.cachedTokens;
    current.cost += group.cost;
    current.failed += group.failed;
    current.tpsSum += group.tpsSum;
    current.tpsCount += group.tpsCount;
    current.latencyMsSum += group.latencyMsSum;
    current.latencyCount += group.latencyCount;
    current.lastUsed = laterOf(current.lastUsed, group.lastUsed);
  }
  return [...merged.values()].sort(newerFirst);
}

// Totals per group over raw rows and daily rollups. `by` lists the columns to
// group by. `buckets` lists half-open [from, to) ISO ranges; rows outside
// every range are left out. Groups come newest first (by lastUsed), which is
// the order a newest-first row scan would meet them in.
export function aggregateUsage(sqlite: Database, scope: UsageScope, options: { by?: UsageDimension[]; buckets?: Array<[string, string]> } = {}): UsageGroup[] {
  const by = options.by || [];
  const raw = aggregateSource(sqlite, RAW_SOURCE, scope, by, options.buckets);
  const rolled = aggregateSource(sqlite, ROLLUP_SOURCE, scope, by, options.buckets);
  // Without GROUP BY each source returns one row, also when it is empty.
  return mergeGroups(raw, rolled.filter((group) => group.requests > 0), by);
}

// Totals over every row in scope.
export function usageTotals(sqlite: Database, scope: UsageScope): UsageTotals {
  return aggregateUsage(sqlite, scope)[0] || totalsOf({});
}

// Request count and newest timestamp per Provider over every row, newest
// first. It reads only the (provider, connectionId, timestamp) index and the
// rollups.
export function usageProviderCounts(sqlite: Database): Array<{ provider: string | null; requests: number; lastUsed: string | null }> {
  const raw = sqlite.query("SELECT provider, COUNT(*) AS requests, MAX(timestamp) AS lastUsed FROM usageHistory INDEXED BY idx_uh_provider_conn_ts GROUP BY provider ORDER BY lastUsed DESC").all() as Array<Record<string, unknown>>;
  const rolled = sqlite.query("SELECT provider, SUM(requests) AS requests, MAX(lastAt) AS lastUsed FROM usageDailyRollup GROUP BY provider ORDER BY lastUsed DESC").all() as Array<Record<string, unknown>>;
  const counts = new Map<string | null, { provider: string | null; requests: number; lastUsed: string | null }>();
  for (const row of [...raw, ...rolled]) {
    const provider = row.provider == null ? null : String(row.provider);
    const lastUsed = row.lastUsed == null ? null : String(row.lastUsed);
    const current = counts.get(provider);
    if (!current) counts.set(provider, { provider, requests: numberValue(row.requests), lastUsed });
    else { current.requests += numberValue(row.requests); current.lastUsed = laterOf(current.lastUsed, lastUsed); }
  }
  return [...counts.values()].sort(newerFirst);
}

// Oldest and newest request times in scope, over raw rows and rollups.
export function usageTimeRange(sqlite: Database, scope: UsageScope): { oldest: string | null; newest: string | null } {
  const range = (table: string, time: string, oldestColumn: string, newestColumn: string) => {
    const { where, values } = scopeSql(scope, true, time);
    // Two statements: SQLite answers a lone MIN or MAX from the index.
    const filter = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const oldest = sqlite.query(`SELECT MIN(${oldestColumn}) AS value FROM ${table}${filter}`).get(...values) as { value: string | null } | null;
    const newest = sqlite.query(`SELECT MAX(${newestColumn}) AS value FROM ${table}${filter}`).get(...values) as { value: string | null } | null;
    return { oldest: oldest?.value ?? null, newest: newest?.value ?? null };
  };
  const raw = range("usageHistory", "timestamp", "timestamp", "timestamp");
  const rolled = range("usageDailyRollup", "lastAt", "firstAt", "lastAt");
  const earlier = (left: string | null, right: string | null) => (left === null || (right !== null && right < left) ? right : left);
  return { oldest: earlier(raw.oldest, rolled.oldest), newest: laterOf(raw.newest, rolled.newest) };
}

const ROLLUP_KEY_COLUMNS = ["day", "provider", "model", "connectionId", "apiKey", "comboName", "clientIp"] as const;
const ROLLUP_SUM_COLUMNS = ["requests", "promptTokens", "completionTokens", "cachedTokens", "cost", "failed", "tpsSum", "tpsCount", "latencyMsSum", "latencyCount"] as const;

// Moves up to `limit` of the oldest raw rows older than `cutoff` into daily
// rollups and deletes them, in one transaction. `dayOf` maps a row timestamp
// to its day key. Returns the number of moved rows. Rows must have derived
// facts (see deriveUsageFacts).
export function rollupUsageBefore(sqlite: Database, cutoff: string, limit: number, dayOf: (timestamp: string) => string): number {
  const rows = sqlite.query(`SELECT id, timestamp, provider, model, connectionId, apiKey, comboName, ${DIMENSION_SQL.clientIp} AS clientIp, promptTokens, completionTokens, cachedTokens, cost, failed, successTps, successLatencyMs FROM usageHistory INDEXED BY idx_uh_ts WHERE timestamp < ? ORDER BY timestamp ASC LIMIT ?`).all(cutoff, Math.max(1, Math.floor(limit))) as Array<Record<string, unknown>>;
  if (!rows.length) return 0;
  type Rollup = Record<(typeof ROLLUP_KEY_COLUMNS)[number], string | null> & Record<(typeof ROLLUP_SUM_COLUMNS)[number], number> & { firstAt: string; lastAt: string };
  const rollups = new Map<string, Rollup>();
  for (const row of rows) {
    const timestamp = String(row.timestamp);
    const text = (value: unknown) => (value == null ? null : String(value));
    const keys = { day: dayOf(timestamp), provider: text(row.provider), model: text(row.model), connectionId: text(row.connectionId), apiKey: text(row.apiKey), comboName: text(row.comboName), clientIp: text(row.clientIp) };
    const id = JSON.stringify(ROLLUP_KEY_COLUMNS.map((column) => keys[column]));
    let rollup = rollups.get(id);
    if (!rollup) {
      rollup = { ...keys, requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, failed: 0, tpsSum: 0, tpsCount: 0, latencyMsSum: 0, latencyCount: 0, firstAt: timestamp, lastAt: timestamp };
      rollups.set(id, rollup);
    }
    rollup.requests += 1;
    rollup.promptTokens += numberValue(row.promptTokens);
    rollup.completionTokens += numberValue(row.completionTokens);
    rollup.cachedTokens += numberValue(row.cachedTokens);
    rollup.cost += numberValue(row.cost);
    rollup.failed += numberValue(row.failed);
    if (row.successTps != null) { rollup.tpsSum += numberValue(row.successTps); rollup.tpsCount += 1; }
    if (row.successLatencyMs != null) { rollup.latencyMsSum += numberValue(row.successLatencyMs); rollup.latencyCount += 1; }
    if (timestamp < rollup.firstAt) rollup.firstAt = timestamp;
    if (timestamp > rollup.lastAt) rollup.lastAt = timestamp;
  }
  // `IS` matches NULL keys too. A day split over batches updates its row.
  const update = sqlite.query(`UPDATE usageDailyRollup SET ${ROLLUP_SUM_COLUMNS.map((column) => `${column} = ${column} + ?`).join(", ")}, firstAt = MIN(firstAt, ?), lastAt = MAX(lastAt, ?) WHERE ${ROLLUP_KEY_COLUMNS.map((column) => `${column} IS ?`).join(" AND ")}`);
  const insert = sqlite.query(`INSERT INTO usageDailyRollup (${[...ROLLUP_KEY_COLUMNS, ...ROLLUP_SUM_COLUMNS, "firstAt", "lastAt"].join(", ")}) VALUES (${[...ROLLUP_KEY_COLUMNS, ...ROLLUP_SUM_COLUMNS, "firstAt", "lastAt"].map(() => "?").join(", ")})`);
  const remove = sqlite.query("DELETE FROM usageHistory WHERE id IN (SELECT value FROM json_each(?))");
  sqlite.transaction(() => {
    for (const rollup of rollups.values()) {
      const sums = ROLLUP_SUM_COLUMNS.map((column) => rollup[column]);
      const keys = ROLLUP_KEY_COLUMNS.map((column) => rollup[column]);
      if (update.run(...sums, rollup.firstAt, rollup.lastAt, ...keys).changes === 0) insert.run(...keys, ...sums, rollup.firstAt, rollup.lastAt);
    }
    remove.run(JSON.stringify(rows.map((row) => row.id)));
  })();
  return rows.length;
}

const ROW_COLUMNS = "id, timestamp, provider, model, connectionId AS connection_id, apiKey AS api_key_id, endpoint, clientIp AS client_ip, promptTokens AS prompt_tokens, completionTokens AS completion_tokens, cost, status, tokens, meta";

export class InvalidUsageCursor extends Error {}

function encodeCursor(row: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify([String(row.timestamp), Number(row.id)])).toString("base64url");
}

function decodeCursor(cursor: string): [string, number] {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1])) return [value[0], value[1]];
  } catch { /* fall through */ }
  throw new InvalidUsageCursor("Invalid cursor");
}

// Raw rows, newest first. Rows that share a timestamp come in write order.
// `cursor` continues after the last row of the previous page. `nextCursor`
// is null on the last page. Throws InvalidUsageCursor for a malformed cursor.
export function usageRowsPage(sqlite: Database, scope: UsageScope, limit: number, cursor?: string | null): { rows: Array<Record<string, unknown>>; nextCursor: string | null } {
  const { where, values } = scopeSql(scope);
  if (cursor) {
    const [timestamp, id] = decodeCursor(cursor);
    where.push("timestamp <= ?", "(timestamp < ? OR id > ?)");
    values.push(timestamp, timestamp, id);
  }
  const size = Math.max(1, Math.floor(limit));
  const rows = sqlite.query(`SELECT ${ROW_COLUMNS} FROM usageHistory${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY timestamp DESC, id ASC LIMIT ?`).all(...values, size + 1) as Array<Record<string, unknown>>;
  const more = rows.length > size;
  if (more) rows.pop();
  return { rows, nextCursor: more ? encodeCursor(rows[rows.length - 1]) : null };
}
