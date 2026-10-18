import { defaultDataDir } from "../services/platform/dataDir.ts";
import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { ApiKeyRecord } from "../db/repositories";
import { generateApiKey, getMachineId, normalizeApiKeyPrefix, validateCustomApiKey } from "../services/platform/apiKeys";

const EMPTY_USAGE = { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, lastUsed: null };

function safeKey(record: Record<string, unknown>) {
  const { key: _key, ...safe } = record;
  return safe;
}

function hasPaginationParams(query: Record<string, string | undefined>): boolean {
  return ["page", "pageSize", "search", "visibility"].some((key) => query[key] !== undefined);
}

function normalizeAccessList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  return Array.from(new Set(list.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)));
}

function normalizeLimit(mode: unknown, value: unknown): { mode: "none" | "requests" | "tokens"; value: number | null } {
  const normalizedMode = mode === "requests" || mode === "tokens" ? mode : "none";
  const normalizedValue = Number(value);
  if (normalizedMode === "none" || !Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return { mode: "none", value: null };
  }
  return { mode: normalizedMode, value: Math.floor(normalizedValue) };
}

function normalizeMaxConcurrency(value: unknown): number | null {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

// Connection pins map combo names to per-model lists of providerConnection
// ids: { [combo]: { [model]: string[] } }. Only string ids are kept.
function normalizeConnectionPins(value: unknown): Record<string, Record<string, string[]>> {
  const pins: Record<string, Record<string, string[]>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return pins;
  for (const [combo, models] of Object.entries(value as Record<string, unknown>)) {
    if (!models || typeof models !== "object" || Array.isArray(models)) continue;
    const entry: Record<string, string[]> = {};
    for (const [model, ids] of Object.entries(models as Record<string, unknown>)) {
      entry[model] = normalizeAccessList(ids);
    }
    pins[combo] = entry;
  }
  return pins;
}

function updatePatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of ["isActive", "isDefault", "resetUsage"] as const) {
    if (body[field] !== undefined) patch[field] = body[field];
  }
  if (body.comboAccessMode !== undefined) patch.comboAccessMode = body.comboAccessMode === "whitelist" ? "whitelist" : "blacklist";
  if (body.comboAccessList !== undefined) patch.comboAccessList = normalizeAccessList(body.comboAccessList);
  if (body.modelAccessMode !== undefined) patch.modelAccessMode = body.modelAccessMode === "blacklist" ? "blacklist" : "whitelist";
  if (body.modelAccessList !== undefined) patch.modelAccessList = normalizeAccessList(body.modelAccessList);
  if (body.limitMode !== undefined || body.limitValue !== undefined) {
    const limit = normalizeLimit(body.limitMode, body.limitValue);
    patch.limitMode = limit.mode;
    patch.limitValue = limit.value;
  }
  if (body.features !== undefined && body.features && typeof body.features === "object" && !Array.isArray(body.features)) {
    patch.features = body.features;
  }
  if (body.maxConcurrency !== undefined) patch.maxConcurrency = normalizeMaxConcurrency(body.maxConcurrency);
  if (body.connectionPins !== undefined) patch.connectionPins = normalizeConnectionPins(body.connectionPins);
  return patch;
}

async function attachUsage(runtime: Runtime, keys: ApiKeyRecord[]): Promise<Array<Record<string, unknown>>> {
  const usage = runtime.repos.usage.apiKeys(keys.map((key) => key.key), "all");
  return keys.map((key) => ({ ...key, usage: usage[key.key] || EMPTY_USAGE }));
}

function paginate<T>(items: T[], query: Record<string, string | undefined>) {
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 10));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, Number(query.page) || 1), totalPages);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, totalItems, totalPages } };
}

// Event parents hold a placeholder secret. getByKey never authenticates it.
function eventPlaceholderKey(): string {
  return `evt_${crypto.randomUUID().replaceAll("-", "")}`;
}

// Participant keys take their policy from the event parent. Only these
// fields stay editable on a participant.
const PARTICIPANT_FIELDS = new Set(["isActive", "resetUsage"]);

export function apiKeyRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", async (c) => {
      const query = c.req.query();
      const topLevel = runtime.repos.keys.list().filter((key) => !key.parentId);
      if (!hasPaginationParams(query)) return c.json({ keys: topLevel });

      const visibility = query.visibility === undefined ? undefined : ["public", "private", "event"].includes(query.visibility) ? query.visibility : "private";
      const search = (query.search || "").trim().toLowerCase();
      const filtered = topLevel.filter((key) => {
        if (visibility && key.visibility !== visibility) return false;
        return !search || String(key.name || "").toLowerCase().includes(search);
      });
      const { items, pagination } = paginate(filtered, query);
      const childCounts = runtime.repos.keys.countChildren();
      const keys = (await attachUsage(runtime, items)).map((key) => key.visibility === "event" ? { ...key, childCount: childCounts.get(String(key.id)) || 0 } : key);
      return c.json({ keys, pagination });
    })
    .post("/", async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      try {
        if (!body.name) return c.json({ error: "Name is required" }, 400);
        const visibility = ["public", "private", "event"].includes(String(body.visibility)) ? String(body.visibility) : "private";
        const isEvent = visibility === "event";
        const prefix = normalizeApiKeyPrefix(body.prefix || body.keyPrefix || runtime.repos.settings.get().apiKeyPrefix);
        const rawCustom = body.customKey ?? body.customValue;
        const custom = rawCustom === undefined || rawCustom === null || String(rawCustom).trim() === ""
          ? null
          : validateCustomApiKey(rawCustom);
        const key = isEvent
          ? eventPlaceholderKey()
          : typeof body.key === "string" && body.key.trim()
          ? body.key.trim()
          : custom
            ? `${prefix}${custom}`
            : generateApiKey(getMachineId(runtime.config.dataDir || defaultDataDir()), prefix);
        const limit = normalizeLimit(body.limitMode, body.limitValue);
        const result = runtime.repos.keys.create({
          ...body,
          key,
          keyPrefix: prefix,
          visibility,
          isDefault: visibility === "public" && body.isDefault === true,
          limitMode: limit.mode,
          limitValue: limit.value,
          maxConcurrency: normalizeMaxConcurrency(body.maxConcurrency),
          connectionPins: normalizeConnectionPins(body.connectionPins),
          parentId: null,
          isActive: 1,
          keyHash: await runtime.auth.hashApiKey(key),
        });
        return c.json({
          key: isEvent ? null : key,
          name: result.record.name,
          id: result.record.id,
          machineId: result.record.machineId,
          visibility: result.record.visibility,
          isDefault: result.record.isDefault,
          limitMode: result.record.limitMode,
          limitValue: result.record.limitValue,
          maxConcurrency: result.record.maxConcurrency,
          connectionPins: result.record.connectionPins,
          features: result.record.features,
          usageRequests: result.record.usageRequests,
          usageTokens: result.record.usageTokens,
        }, 201);
      } catch (error: any) {
        const message = error instanceof Error ? error.message : "Invalid API key";
        if (/already exists|UNIQUE constraint/i.test(message)) return c.json({ error: "An API key with this value already exists" }, 409);
        return c.json({ error: message }, 400);
      }
    })
    .get("/config", (c) => c.json({ prefix: normalizeApiKeyPrefix(runtime.repos.settings.get().apiKeyPrefix) }))
    .get("/:id/secret", (c) => {
      const record = runtime.repos.keys.list().find((item) => item.id === c.req.param("id"));
      if (record?.visibility === "event" && !record.parentId) return c.json({ error: "Event keys have no secret" }, 400);
      const key = runtime.repos.keys.getSecret(c.req.param("id"));
      return key ? c.json({ key }) : c.json({ error: "Key not found" }, 404);
    })
    .patch("/config", async (c) => {
      try {
        const body = await c.req.json<{ prefix?: string }>();
        if (typeof body.prefix !== "string") return c.json({ error: "Prefix is required" }, 400);
        const prefix = normalizeApiKeyPrefix(body.prefix);
        const settings = runtime.repos.settings.update({ apiKeyPrefix: prefix });
        return c.json({ prefix: normalizeApiKeyPrefix(settings.apiKeyPrefix) });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Invalid API key prefix" }, 400);
      }
    })
    .get("/:id/children", async (c) => {
      const parent = runtime.repos.keys.list().find((item) => item.id === c.req.param("id"));
      if (!parent || parent.visibility !== "event" || parent.parentId) return c.json({ error: "Event key not found" }, 404);
      const query = c.req.query();
      const search = (query.search || "").trim().toLowerCase();
      const children = runtime.repos.keys.listChildren(parent.id).filter((key) => !search || String(key.name || "").toLowerCase().includes(search));
      const { items, pagination } = paginate(children, query);
      const keys = (await attachUsage(runtime, items)).map(safeKey);
      return c.json({ keys, pagination });
    })
    .get("/:id", async (c) => {
      const key = runtime.repos.keys.list().find((item) => item.id === c.req.param("id"));
      return key ? c.json({ key: safeKey({ ...key }) }) : c.json({ error: "Key not found" }, 404);
    })
    .put("/:id", async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      const existing = runtime.repos.keys.list().find((item) => item.id === c.req.param("id"));
      if (!existing) return c.json({ error: "Key not found" }, 404);
      if (body.isDefault === true && existing.visibility !== "public") return c.json({ error: "Only public API keys can be set as default" }, 400);
      if (existing.parentId && Object.keys(body).some((field) => !PARTICIPANT_FIELDS.has(field))) {
        return c.json({ error: "Participant keys inherit their policy from the event" }, 400);
      }
      try {
        const patch = updatePatch(body);
        const updated = runtime.repos.keys.update(existing.id, patch);
        if (!updated) return c.json({ error: "Key not found" }, 404);
        return c.json({ key: safeKey({ ...updated }) });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Failed to update key" }, 400);
      }
    })
    .delete("/:id", (c) => {
      const existing = runtime.repos.keys.list().find((item) => item.id === c.req.param("id"));
      if (!existing) return c.json({ error: "Key not found" }, 404);
      return runtime.repos.keys.remove(existing.id) ? c.json({ message: "Key deleted successfully" }) : c.json({ error: "Key not found" }, 404);
    });
}
