// Boot-time sync: materialize the v1 registry into the `models` table so the
// dashboard can query and search models through SQL instead of iterating the
// in-memory registry. The registry stays the seed source of truth; the table
// holds registry + custom + discovered rows keyed by composite id "alias/modelId".
import type { Runtime } from "../../runtime";
import { getProviderCatalog, getProviderMetadata } from "./providerCatalog";

const MODELS_MIGRATED_KEY = "modelsMigratedV1";

function parseJson(value: unknown, fallback: unknown = null): unknown {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function modelKind(model: Record<string, unknown>): string {
  return String(model.kind || model.type || "llm");
}

// Mirrors modelCatalog.modelCapabilities so stored caps read identically.
function registryCaps(model: Record<string, unknown>): Record<string, unknown> {
  const caps = model.capabilities && typeof model.capabilities === "object" ? model.capabilities as Record<string, unknown> : {};
  const params = Array.isArray(model.params) ? model.params.map(String) : [];
  return { ...caps, ...(params.length ? { params } : {}) };
}

const UPSERT = `INSERT INTO models (id, provider, providerAlias, modelId, name, kind, source, upstreamModelId, quotaFamily, contextLength, capabilities, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function runUpsert(runtime: Runtime, row: Record<string, unknown>, source: string, onConflict: string) {
  const timestamp = new Date().toISOString();
  runtime.sqlite.query(`${UPSERT} ${onConflict}`).run(
    String(row.id),
    String(row.provider),
    String(row.providerAlias),
    String(row.modelId),
    String(row.name),
    String(row.kind),
    source,
    row.upstreamModelId == null ? null : String(row.upstreamModelId),
    row.quotaFamily == null ? null : String(row.quotaFamily),
    row.contextLength == null ? null : Number(row.contextLength),
    JSON.stringify(row.capabilities ?? {}),
    Number(row.sortOrder ?? 999),
    timestamp,
    timestamp,
  );
}

// One-time lift of the legacy kv customModels blob into source='custom' rows.
function migrateCustomModels(runtime: Runtime): void {
  const flag = runtime.sqlite.query("SELECT value FROM _meta WHERE key = ?").get(MODELS_MIGRATED_KEY) as { value?: string } | null;
  if (flag) return;
  const rows = runtime.sqlite.query("SELECT key, value FROM kv WHERE scope = 'customModels'").all() as Array<{ key: string; value: string }>;
  for (const row of rows) {
    const model = parseJson(row.value, {});
    if (!model || typeof model !== "object") continue;
    const modelId = String((model as Record<string, unknown>).id || (model as Record<string, unknown>).model || "").trim();
    if (!modelId) continue;
    runtime.repos.models.upsert(model as Record<string, unknown>);
  }
  runtime.sqlite.query("DELETE FROM kv WHERE scope = 'customModels'").run();
  runtime.sqlite.query("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, '1')").run(MODELS_MIGRATED_KEY);
}

// Hard-sync registry rows: insert new, refresh changed, delete removed. Only
// ever touches source='registry' rows, so custom/discovered rows survive.
function syncRegistryModels(runtime: Runtime): void {
  const desired = new Set<string>();
  for (const provider of getProviderCatalog()) {
    if (provider.hidden) continue;
    let sortOrder = 0;
    for (const model of provider.models) {
      const modelId = String(model.id || "").trim();
      if (!modelId) continue;
      const id = `${provider.alias}/${modelId}`;
      desired.add(id);
      runUpsert(runtime, {
        id,
        provider: provider.id,
        providerAlias: provider.alias,
        modelId,
        name: String(model.name || modelId),
        kind: modelKind(model),
        upstreamModelId: model.upstreamModelId ?? null,
        quotaFamily: model.quotaFamily ?? null,
        contextLength: typeof model.contextLength === "number" ? model.contextLength : null,
        capabilities: registryCaps(model),
        sortOrder,
      }, "registry", "ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, upstreamModelId = excluded.upstreamModelId, quotaFamily = excluded.quotaFamily, contextLength = excluded.contextLength, capabilities = excluded.capabilities, sortOrder = excluded.sortOrder, updatedAt = excluded.updatedAt WHERE models.source = 'registry'");
      sortOrder += 1;
    }
  }
  const existing = runtime.sqlite.query("SELECT id FROM models WHERE source = 'registry'").all() as Array<{ id: string }>;
  for (const row of existing) if (!desired.has(row.id)) runtime.sqlite.query("DELETE FROM models WHERE id = ? AND source = 'registry'").run(row.id);
}

// Re-derive discovered rows from live connection data.models so per-connection
// discovery results stay searchable. Refresh on boot; never deletes other sources.
function syncDiscoveredModels(runtime: Runtime): void {
  const desired = new Set<string>();
  for (const connection of runtime.repos.providers.list(true)) {
    const metadata = getProviderMetadata(connection.provider);
    const alias = String((connection.data as Record<string, unknown> | undefined)?.prefix || metadata?.alias || connection.provider);
    const configured = Array.isArray((connection.data as Record<string, unknown> | undefined)?.models)
      ? ((connection.data as Record<string, unknown>).models as unknown[]).map(String)
      : [];
    for (const modelId of configured) {
      if (!modelId) continue;
      const id = `${alias}/${modelId}`;
      desired.add(id);
      runUpsert(runtime, {
        id,
        provider: connection.provider,
        providerAlias: alias,
        modelId,
        name: modelId,
        kind: "llm",
        capabilities: {} as Record<string, any>,
        sortOrder: 999,
      }, "discovered", "ON CONFLICT(id) DO UPDATE SET name = excluded.name, updatedAt = excluded.updatedAt WHERE models.source = 'discovered'");
    }
  }
  const existing = runtime.sqlite.query("SELECT id FROM models WHERE source = 'discovered'").all() as Array<{ id: string }>;
  for (const row of existing) if (!desired.has(row.id)) runtime.sqlite.query("DELETE FROM models WHERE id = ? AND source = 'discovered'").run(row.id);
}

export function syncModelCatalog(runtime: Runtime): void {
  try {
    migrateCustomModels(runtime);
    syncRegistryModels(runtime);
    syncDiscoveredModels(runtime);
  } catch (error: any) {
    console.warn(`[ModelSync] failed: ${(error as Error).message}`);
  }
}
