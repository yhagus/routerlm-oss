// Shared Usage fixture: one fixed set of recorded requests and the dashboard
// paths that read it. usageSqlEquivalence pins the responses in snapshots.
// usageRetention checks that the responses stay the same after rollup.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { loadRuntimeConfig } from "../src/config";
import { applyMigrations } from "../src/db/migrate";
import { createRuntime, type Runtime } from "../src/runtime";

export const NOW = Date.parse("2026-03-18T15:47:12.345Z");
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
export const KEY = "sk-fixture-key-a";

export const RAW_INSERT = "INSERT INTO usageHistory (timestamp, provider, model, connectionId, apiKey, endpoint, clientIp, promptTokens, completionTokens, cost, status, tokens, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

// Rows written before this runtime started, the way older builds stored them.
function seedLegacyRows(databasePath: string): void {
  const sqlite = new Database(databasePath);
  applyMigrations(sqlite);
  const insert = sqlite.query(RAW_INSERT);
  insert.run(at(-4 * DAY), "openai", "gpt", "conn-b", null, "/v1/chat/completions", "10.0.0.3", 120, 30, 0.5, null, JSON.stringify({ prompt_tokens: 120, completion_tokens: 30, cached_tokens: 20 }), JSON.stringify({ comboName: "combo-b", tokensPerSecond: "12.5", totalMs: 750 }));
  insert.run(at(-2 * HOUR), "", null, null, null, null, null, 7, 3, null, "", null, null);
  insert.run(at(-5 * DAY), "claude", "sonnet", "conn-a", null, null, null, 9, 1, 0.25, "success", "not json", "garbage");
  sqlite.close();
}

function recordFixture(runtime: Runtime): void {
  runtime.repos.keys.create({ id: "key-a", key: KEY, name: "Fixture key" });
  const record = runtime.repos.usage.record.bind(runtime.repos.usage);
  record({ timestamp: at(-1 * MINUTE), provider: "claude", model: "sonnet", connectionId: "conn-a", apiKey: KEY, clientIp: "10.0.0.1", status: "success", cost: 0.25, tokens: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 30 }, meta: { comboName: "combo-a", tokensPerSecond: 40, totalMs: 1000 } });
  record({ timestamp: at(-3 * MINUTE), provider: "openai", model: "gpt", connectionId: "conn-b", clientIp: " 10.0.0.2 ", status: "error", cost: 0, tokens: { prompt_tokens: 50, completion_tokens: 0 }, meta: { comboName: " combo-b " } });
  record({ timestamp: at(-20 * MINUTE), provider: "claude", model: "sonnet", connectionId: "conn-a", apiKey: KEY, clientIp: "10.0.0.1", status: "ok", cost: 0.5, promptTokens: 200, completionTokens: 80, meta: { tokensPerSecond: 52.5, totalMs: 2000 } });
  record({ timestamp: at(-3 * HOUR), provider: "claude", model: "haiku", connectionId: "conn-b", status: "429", cost: 0.125, tokens: { prompt_tokens: 300, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 100 } } });
  record({ timestamp: at(-10 * HOUR), model: "mystery", status: "success", cost: 0, promptTokens: 10, completionTokens: 5 });
  record({ timestamp: at(-23 * HOUR), provider: "openai", model: "gpt", connectionId: "conn-a", apiKey: KEY, status: "success", cost: 1, promptTokens: 400, completionTokens: 100, meta: { comboName: "combo-a", tokensPerSecond: 0, totalMs: 500 } });
  record({ timestamp: at(-2 * DAY), provider: "openai", model: "gpt-mini", connectionId: "conn-b", apiKey: KEY, status: "Success", cost: 2, promptTokens: 1000, completionTokens: 200 });
  record({ timestamp: at(-6 * DAY), provider: "claude", model: "sonnet", connectionId: "conn-a", status: "success", cost: 0.75, promptTokens: 70, completionTokens: 30, meta: { comboName: "unknown" } });
  record({ timestamp: at(-12 * DAY), provider: "mistral", model: "flash", connectionId: "conn-c", status: "failed", cost: 0, promptTokens: 60, completionTokens: 0 });
  record({ timestamp: at(-45 * DAY), provider: "claude", model: "sonnet", connectionId: "conn-a", apiKey: KEY, status: "success", cost: 4, promptTokens: 500, completionTokens: 500 });
  record({ timestamp: at(-90 * DAY), provider: "openai", model: "gpt", connectionId: "conn-b", status: "success", cost: 8, promptTokens: 800, completionTokens: 200 });
  record({ timestamp: at(3 * MINUTE), provider: "claude", model: "sonnet", connectionId: "conn-a", status: "success", cost: 0.25, promptTokens: 5, completionTokens: 5 });
  runtime.repos.usage.flush();
  // A row written after start-up by a writer outside usage.record.
  runtime.sqlite.query(RAW_INSERT).run(at(-30 * MINUTE), "openai", "gpt", "conn-a", KEY, null, null, 40, 10, 0.25, "success", JSON.stringify({ input_tokens: 40, output_tokens: 10 }), JSON.stringify({ comboName: "combo-a", tokensPerSecond: 20, totalMs: 400 }));
}

// A runtime on a file database that holds the fixture rows. Call
// setSystemTime(new Date(NOW)) first.
export async function createFixtureRuntime(name: string): Promise<Runtime> {
  const dataDir = `/tmp/lobakai-${name}-${crypto.randomUUID()}`;
  mkdirSync(`${dataDir}/db`, { recursive: true });
  const databasePath = `${dataDir}/db/usage.sqlite`;
  seedLegacyRows(databasePath);
  const runtime = await createRuntime(loadRuntimeConfig({ BACKEND_HOST: "127.0.0.1", BACKEND_DATABASE_PATH: databasePath, DATA_DIR: dataDir, REQUIRE_LOGIN: "false" }));
  recordFixture(runtime);
  return runtime;
}

const PERIODS = ["1h", "today", "24h", "7d", "30d", "60d", "all"];
const TREND_BY = ["provider", "account", "model", "combo", "apiKey"];

// Paths that return totals and series. The public stats path comes last.
export const AGGREGATE_PATHS: string[] = [
  ...PERIODS.map((period) => `/api/usage/stats?period=${period}`),
  "/api/usage/stats",
  ...PERIODS.map((period) => `/api/usage/dashboard?period=${period}`),
  ...PERIODS.map((period) => `/api/usage/chart?period=${period}`),
  ...PERIODS.map((period) => `/api/usage/overview?period=${period}`),
  "/api/usage/overview?period=7d&models=2",
  ...PERIODS.flatMap((period) => TREND_BY.map((by) => `/api/usage/trend?by=${by}&period=${period}&top=2`)),
  "/api/usage/trend?by=model&period=all&top=10",
  "/api/usage/providers",
  ...PERIODS.map((period) => `/api/usage/by-provider?period=${period}`),
  "/api/usage/by-provider/claude",
  "/api/usage/by-provider/openai?period=7d&recentLimit=2",
  "/api/usage/by-provider/unknown",
  ...PERIODS.map((period) => `/api/usage/by-account?period=${period}`),
  "/api/usage/by-account/conn-a",
  "/api/usage/by-account/conn-b?period=24h",
  ...PERIODS.map((period) => `/api/usage/by-model?period=${period}`),
  ...PERIODS.map((period) => `/api/usage/by-combo?period=${period}`),
  "/api/usage/by-combo?period=all&sort=tokens",
  ...PERIODS.map((period) => `/api/usage/api-keys?period=${period}`),
  "/api/usage/api-keys/key-a",
  "/api/usage/api-keys/key-a?period=7d&recentLimit=3",
  "/api/public/stats?apikey=sk-fixture-key-a",
];

// Paths that list raw rows.
export const RAW_ROW_PATHS: string[] = ["/api/usage/logs", "/api/usage/request-logs"];
