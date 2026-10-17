import type { Runtime } from "../../runtime";
import { invalidateCustomNodes } from "../providers/customNodes.ts";

type JsonObject = Record<string, any>;

function parse(value: unknown, fallback: any): any {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function timestamp(value: unknown): string {
  return typeof value === "string" && value ? value : new Date().toISOString();
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface DatabaseBackup {
  settings: JsonObject;
  providerConnections: JsonObject[];
  providerNodes: JsonObject[];
  proxyPools: JsonObject[];
  apiKeys: JsonObject[];
  apiKeyConfig: { prefix: string };
  combos: JsonObject[];
  modelAliases: JsonObject;
  customModels: JsonObject[];
  mitmAlias: JsonObject;
  pricing: JsonObject;
  modelContextWindows: JsonObject;
  modelCapabilityOverrides: JsonObject;
}

export function exportDatabase(runtime: Runtime): DatabaseBackup {
  const sqlite: any = runtime.sqlite;
  const rows = (sql: string, ...params: unknown[]) => sqlite.query(sql).all(...params) as JsonObject[];
  const apiKeyConfig = sqlite.query("SELECT prefix FROM apiKeyConfig WHERE id = 1").get() as { prefix?: string } | null;
  const result: DatabaseBackup = {
    settings: object((sqlite.query("SELECT data FROM settings WHERE id = 1").get() as { data?: string } | null)?.data ? parse((sqlite.query("SELECT data FROM settings WHERE id = 1").get() as { data?: string }).data, {}) : {}),
    providerConnections: rows("SELECT * FROM providerConnections").map((row) => ({ ...parse(row.data, {}), id: row.id, provider: row.provider, authType: row.authType, name: row.name, email: row.email, priority: row.priority, isActive: row.isActive === 1, createdAt: row.createdAt, updatedAt: row.updatedAt })),
    providerNodes: rows("SELECT * FROM providerNodes").map((row) => ({ ...parse(row.data, {}), id: row.id, type: row.type, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt })),
    proxyPools: rows("SELECT * FROM proxyPools").map((row) => ({ ...parse(row.data, {}), id: row.id, isActive: row.isActive === 1, testStatus: row.testStatus, createdAt: row.createdAt, updatedAt: row.updatedAt })),
    apiKeys: rows("SELECT * FROM apiKeys").map((row) => ({
      id: row.id, key: row.key, name: row.name, machineId: row.machineId, isActive: row.isActive === 1,
      comboAccessMode: row.comboAccessMode || "blacklist", comboAccessList: parse(row.comboAccessList, []),
      modelAccessMode: row.modelAccessMode || "whitelist", modelAccessList: parse(row.modelAccessList, []),
      visibility: row.visibility === "public" ? "public" : "private", isDefault: row.visibility === "public" && (row.isDefault === 1 || row.isDefault === true),
      limitMode: row.limitMode === "requests" || row.limitMode === "tokens" ? row.limitMode : "none",
      limitValue: row.limitValue == null || Number(row.limitValue) <= 0 ? null : Math.floor(Number(row.limitValue)),
      usageRequests: Number(row.usageRequests) || 0, usageTokens: Number(row.usageTokens) || 0, features: parse(row.features, {}), createdAt: row.createdAt,
    })),
    apiKeyConfig: { prefix: apiKeyConfig?.prefix || "sk-" },
    combos: rows("SELECT * FROM combos").map((row) => ({ id: row.id, name: row.name, kind: row.kind, models: parse(row.models, []), identityEnabled: row.identityEnabled === 1, accountFilters: parse(row.accountFilters, {}), useCustomAccountOrder: row.useCustomAccountOrder === 1, createdAt: row.createdAt, updatedAt: row.updatedAt })),
    modelAliases: {} as Record<string, any>, customModels: [] as any[], mitmAlias: {} as Record<string, any>, pricing: {} as Record<string, any>, modelContextWindows: {} as Record<string, any>, modelCapabilityOverrides: {} as Record<string, any>,
  };
  for (const row of rows("SELECT key, value FROM kv WHERE scope = 'modelAliases'")) result.modelAliases[String(row.key)] = parse(row.value, row.value);
  for (const row of rows("SELECT * FROM models WHERE source = 'custom'")) result.customModels.push({ providerAlias: String(row.providerAlias || ""), id: String(row.modelId || ""), model: String(row.modelId || ""), type: String(row.kind || "llm"), name: String(row.name || "") });
  for (const row of rows("SELECT key, value FROM kv WHERE scope = 'mitmAlias'")) result.mitmAlias[String(row.key)] = parse(row.value, row.value);
  for (const row of rows("SELECT key, value FROM kv WHERE scope = 'pricing'")) result.pricing[String(row.key)] = parse(row.value, row.value);
  for (const row of rows("SELECT key, value FROM kv WHERE scope = 'modelContextWindows'")) result.modelContextWindows[String(row.key)] = parse(row.value, row.value);
  for (const row of rows("SELECT key, value FROM kv WHERE scope = 'modelCapabilityOverrides'")) result.modelCapabilityOverrides[String(row.key)] = parse(row.value, row.value);
  return result;
}

export function validateDatabasePayload(payload: unknown): DatabaseBackup {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid database payload");
  const input = payload as JsonObject;
  return {
    settings: object(input.settings), providerConnections: array(input.providerConnections) as JsonObject[], providerNodes: array(input.providerNodes) as JsonObject[], proxyPools: array(input.proxyPools) as JsonObject[], apiKeys: array(input.apiKeys) as JsonObject[],
    apiKeyConfig: { prefix: typeof input.apiKeyConfig?.prefix === "string" && input.apiKeyConfig.prefix ? input.apiKeyConfig.prefix : "sk-" },
    combos: array(input.combos) as JsonObject[], modelAliases: object(input.modelAliases), customModels: array(input.customModels) as JsonObject[], mitmAlias: object(input.mitmAlias), pricing: object(input.pricing), modelContextWindows: object(input.modelContextWindows), modelCapabilityOverrides: object(input.modelCapabilityOverrides),
  };
}

export function importDatabase(runtime: Runtime, rawPayload: unknown): DatabaseBackup {
  const payload = validateDatabasePayload(rawPayload);
  const sqlite: any = runtime.sqlite;
  sqlite.transaction(() => {
    for (const table of ["settings", "providerConnections", "providerNodes", "proxyPools", "apiKeys", "apiKeyConfig", "combos"]) sqlite.query(`DELETE FROM ${table}`).run();
    sqlite.query("DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing', 'modelContextWindows', 'modelCapabilityOverrides')").run();
    sqlite.query("INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(JSON.stringify(payload.settings));
    sqlite.query("INSERT INTO apiKeyConfig(id, prefix) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET prefix = excluded.prefix").run(payload.apiKeyConfig.prefix);

    for (const item of payload.providerConnections) { const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...data } = item; sqlite.query("INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, provider, authType || "oauth", name ?? null, email ?? null, priority ?? null, isActive === false ? 0 : 1, JSON.stringify(data), timestamp(createdAt), timestamp(updatedAt)); }
    for (const item of payload.providerNodes) { const { id, type, name, createdAt, updatedAt, ...data } = item; sqlite.query("INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)").run(id, type ?? null, name ?? null, JSON.stringify(data), timestamp(createdAt), timestamp(updatedAt)); }
    for (const item of payload.proxyPools) { const { id, isActive, testStatus, createdAt, updatedAt, ...data } = item; sqlite.query("INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)").run(id, isActive === false ? 0 : 1, testStatus || "unknown", JSON.stringify(data), timestamp(createdAt), timestamp(updatedAt)); }
    for (const item of payload.apiKeys) { const publicKey = item.visibility === "public"; const mode = item.limitMode === "requests" || item.limitMode === "tokens" ? item.limitMode : "none"; const limit = Number(item.limitValue) > 0 ? Math.floor(Number(item.limitValue)) : null; sqlite.query("INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, comboAccessMode, comboAccessList, modelAccessMode, modelAccessList, visibility, isDefault, limitMode, limitValue, usageRequests, usageTokens, features, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(item.id, item.key, item.name ?? null, item.machineId ?? null, item.isActive === false ? 0 : 1, item.comboAccessMode === "whitelist" ? "whitelist" : "blacklist", JSON.stringify(array(item.comboAccessList)), item.modelAccessMode === "blacklist" ? "blacklist" : "whitelist", JSON.stringify(array(item.modelAccessList)), publicKey ? "public" : "private", publicKey && item.isDefault ? 1 : 0, limit == null ? "none" : mode, limit, Number(item.usageRequests) || 0, Number(item.usageTokens) || 0, JSON.stringify(object(item.features)), timestamp(item.createdAt)); }
    for (const item of payload.combos) sqlite.query("INSERT OR REPLACE INTO combos(id, name, kind, models, identityEnabled, accountFilters, useCustomAccountOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(item.id, item.name, item.kind ?? null, JSON.stringify(array(item.models)), item.identityEnabled === true ? 1 : 0, JSON.stringify(object(item.accountFilters)), item.useCustomAccountOrder === true ? 1 : 0, timestamp(item.createdAt), timestamp(item.updatedAt));
    for (const [key, value] of Object.entries(payload.modelAliases as Record<string, any>)) sqlite.query("INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)").run(key, JSON.stringify(value));
    sqlite.query("DELETE FROM models WHERE source = 'custom'").run();
    for (const item of payload.customModels) { const providerAlias = String(item.providerAlias || item.provider || "custom"); const modelId = String(item.id || item.model || ""); if (!modelId) continue; const kind = String(item.kind || item.type || "llm"); sqlite.query("INSERT OR REPLACE INTO models(id, provider, providerAlias, modelId, name, kind, source, capabilities, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 'custom', '{}', 999, ?, ?)").run(`${providerAlias}/${modelId}`, providerAlias, providerAlias, modelId, String(item.name || modelId), kind, timestamp(item.createdAt), timestamp(item.updatedAt)); }
    for (const [key, value] of Object.entries(payload.mitmAlias as Record<string, any>)) sqlite.query("INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)").run(key, JSON.stringify(value));
    for (const [key, value] of Object.entries(payload.pricing as Record<string, any>)) sqlite.query("INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)").run(key, JSON.stringify(value));
    for (const [key, value] of Object.entries(payload.modelContextWindows as Record<string, any>)) sqlite.query("INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelContextWindows', ?, ?)").run(key, JSON.stringify(value));
    for (const [key, value] of Object.entries(payload.modelCapabilityOverrides as Record<string, any>)) sqlite.query("INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelCapabilityOverrides', ?, ?)").run(key, JSON.stringify(value));
  })();
  invalidateCustomNodes();
  return exportDatabase(runtime);
}
