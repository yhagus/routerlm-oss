import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { modelManagementCatalog, searchModelCatalog } from "../services/providers/modelCatalog";
import { pingModelByKind } from "../services/providers/modelPing";
import { MODEL_CAPABILITY_SCOPE, normalizeCapabilityOverride, parseStoredOverride } from "../services/providers/modelCapabilityOverrides";

const MODEL_LOCK_PREFIX = "modelLock_";

function activeModelLocks(data: Record<string, unknown>) {
  const now = Date.now();
  return Object.entries(data as Record<string, any>)
    .filter(([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) && value)
    .map(([key, value]) => ({
      key,
      model: key.slice(MODEL_LOCK_PREFIX.length) || "__all",
      until: value,
      active: new Date(String(value)).getTime() > now,
    }))
    .filter((lock) => lock.active);
}

export function modelRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", (c) => c.json({ models: modelManagementCatalog(runtime) }))
    .get("/custom", (c) => c.json({ models: runtime.repos.models.all() }))
    .post("/custom", async (c) => { const body = await c.req.json<Record<string, unknown>>(); if (!body.providerAlias || !body.id) return c.json({ error: "providerAlias and id required" }, 400); return c.json({ success: true, added: runtime.repos.models.upsert({ ...body, provider: body.providerAlias, model: body.id, kind: body.type || "llm" }) }, 201); })
    .delete("/custom", async (c) => { const providerAlias = c.req.query("providerAlias"); const id = c.req.query("id"); if (!providerAlias || !id) return c.json({ error: "providerAlias and id required" }, 400); return c.json({ success: runtime.repos.models.remove(`${providerAlias}/${id}`) || runtime.repos.models.remove(id) }); })
    .get("/disabled", (c) => {
      const provider = c.req.query("providerAlias");
      const rows = provider ? runtime.sqlite.query("SELECT key, value FROM kv WHERE scope = 'disabledModels' AND key = ?").all(provider) : runtime.sqlite.query("SELECT key, value FROM kv WHERE scope = 'disabledModels'").all();
       if (provider) return c.json({ ids: rows.flatMap((row: any) => { try { return JSON.parse(row.value); } catch { return []; } }) });
       return c.json({ disabled: Object.fromEntries(rows.map((row: any) => { try { return [row.key, JSON.parse(row.value)]; } catch { return [row.key, []]; } })) });
    })
    .post("/disabled", async (c) => {
      const body = await c.req.json<{ providerAlias?: string; ids?: string[]; id?: string; disabled?: boolean }>();
      const provider = String(body.providerAlias || "");
      if (!provider) return c.json({ error: "providerAlias is required" }, 400);
      const current = (runtime.sqlite.query("SELECT value FROM kv WHERE scope = 'disabledModels' AND key = ?").get(provider) as { value?: string } | null);
       let existingIds: string[] = [];
       try { existingIds = JSON.parse(current?.value || "[]"); } catch { existingIds = []; }
       const ids = new Set<string>(existingIds);
      for (const id of body.ids || (body.id ? [body.id] : [])) body.disabled === false ? ids.delete(id) : ids.add(id);
      runtime.sqlite.query("INSERT INTO kv(scope, key, value) VALUES ('disabledModels', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value").run(provider, JSON.stringify([...ids]));
       return c.json({ success: true });
    })
    .delete("/disabled", (c) => {
      const provider = c.req.query("providerAlias"); const id = c.req.query("id");
      if (!provider) return c.json({ error: "providerAlias is required" }, 400);
      if (!id) runtime.sqlite.query("DELETE FROM kv WHERE scope = 'disabledModels' AND key = ?").run(provider);
      else {
        const row = runtime.sqlite.query("SELECT value FROM kv WHERE scope = 'disabledModels' AND key = ?").get(provider) as { value?: string } | null;
        let ids: string[] = []; try { ids = JSON.parse(row?.value || "[]"); } catch { /* reset malformed state */ }
        runtime.sqlite.query("INSERT INTO kv(scope, key, value) VALUES ('disabledModels', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value").run(provider, JSON.stringify(ids.filter((item) => item !== id)));
      }
       return c.json({ success: true });
    })
     .get("/context-window", (c) => { const provider = c.req.query("provider"); const rows = runtime.sqlite.query("SELECT key, value FROM kv WHERE scope = 'modelContextWindows'").all() as Array<{ key: string; value: string | number }>; const overrides = Object.fromEntries(rows.filter((row) => !provider || row.key.startsWith(`${provider}/`)).map((row) => { const raw = typeof row.value === "string" ? row.value : String(row.value); const parsed = Number(raw); return [provider ? row.key.slice(provider.length + 1) : row.key, Number.isFinite(parsed) ? parsed : null]; }).filter(([, value]) => value !== null)); return c.json({ overrides }); })
     .put("/context-window", async (c) => { const body = await c.req.json<{ provider?: string; model?: string; contextWindow?: number }>(); const window = Number(body.contextWindow); if (!body.provider || !body.model || !Number.isFinite(window) || window <= 0) return c.json({ error: "provider, model, and positive integer contextWindow required" }, 400); runtime.sqlite.query("INSERT INTO kv(scope, key, value) VALUES ('modelContextWindows', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value").run(`${body.provider}/${body.model}`, JSON.stringify(Math.min(Math.floor(window), 2_000_000))); return c.json({ success: true, provider: body.provider, model: body.model, contextWindow: Math.min(Math.floor(window), 2_000_000) }); })
     .delete("/context-window", (c) => { const provider = c.req.query("provider"); const model = c.req.query("model"); if (!provider || !model) return c.json({ error: "provider and model required" }, 400); runtime.sqlite.query("DELETE FROM kv WHERE scope = 'modelContextWindows' AND key = ?").run(`${provider}/${model}`); return c.json({ success: true, provider, model }); })
     .get("/capabilities", (c) => {
       const provider = c.req.query("provider");
       const rows = runtime.sqlite.query("SELECT key, value FROM kv WHERE scope = ?").all(MODEL_CAPABILITY_SCOPE) as Array<{ key: string; value: string }>;
       const overrides = Object.fromEntries(rows.flatMap((row) => {
         if (provider && !row.key.startsWith(`${provider}/`)) return [];
         const override = parseStoredOverride(row.value);
         if (!override) return [];
         const key = provider ? row.key.slice(provider.length + 1) : row.key;
         return [[key, override]];
       }));
       return c.json({ overrides });
     })
     .put("/capabilities", async (c) => {
       const body = await c.req.json<{ provider?: string; model?: string; capabilities?: Record<string, unknown> }>();
       const provider = String(body.provider || "").trim();
       const model = String(body.model || "").trim();
       const capabilities = normalizeCapabilityOverride(body.capabilities);
       if (!provider || !model || !capabilities) return c.json({ error: "provider, model, and capabilities required" }, 400);
       runtime.sqlite.query("INSERT INTO kv(scope, key, value) VALUES (?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value").run(MODEL_CAPABILITY_SCOPE, `${provider}/${model}`, JSON.stringify(capabilities));
       const custom = runtime.sqlite.query("SELECT id FROM models WHERE source = 'custom' AND providerAlias = ? AND modelId = ?").get(provider, model) as { id?: string } | null;
       if (custom?.id) runtime.sqlite.query("UPDATE models SET capabilities = ?, updatedAt = ? WHERE id = ? AND source = 'custom'").run(JSON.stringify(capabilities), new Date().toISOString(), custom.id);
       return c.json({ success: true, provider, model, capabilities });
     })
     .get("/alias", (c) => c.json({ aliases: runtime.repos.aliases.list() }))
     .put("/alias", async (c) => { const body = await c.req.json<{ model?: string; alias?: string; targetModel?: string }>(); const model = body.model || body.targetModel; if (!body.alias || !model) return c.json({ error: "Model and alias required" }, 400); runtime.repos.aliases.set(body.alias, model); return c.json({ success: true, model, alias: body.alias }); })
     .delete("/alias", (c) => { const alias = c.req.query("alias"); if (!alias) return c.json({ error: "Alias required" }, 400); runtime.repos.aliases.remove(alias); return c.json({ success: true }); })
     .get("/availability", (c) => {
       const models: Array<Record<string, unknown>> = [];
       for (const connection of runtime.repos.providers.list(true)) {
         const locks = activeModelLocks(connection.data);
         for (const lock of locks) {
           models.push({
             provider: connection.provider,
             model: lock.model,
             status: "cooldown",
             until: lock.until,
             connectionId: connection.id,
             connectionName: connection.name || connection.email || connection.id,
             lastError: connection.data.lastError || null,
           });
         }
         if (locks.length === 0 && connection.data.testStatus === "unavailable") {
           models.push({
             provider: connection.provider,
             model: "__all",
             status: "unavailable",
             connectionId: connection.id,
             connectionName: connection.name || connection.email || connection.id,
             lastError: connection.data.lastError || null,
           });
         }
       }
       return c.json({ models, unavailableCount: models.length });
     })
     .post("/availability", async (c) => {
       const body = await c.req.json<{ action?: string; provider?: string; model?: string }>().catch(() => ({}) as { action?: string; provider?: string; model?: string });
       if (body.action !== "clearCooldown" || !body.provider || !body.model) return c.json({ error: "Invalid request" }, 400);
       const lockKey = `${MODEL_LOCK_PREFIX}${body.model}`;
       const connections = runtime.repos.providers.list(true).filter((connection) => connection.provider === body.provider && connection.data[lockKey]);
       for (const connection of connections) {
         const patch: Record<string, unknown> = { [lockKey]: null };
         if (connection.data.testStatus === "unavailable") {
           patch.testStatus = "active";
           patch.lastError = null;
           patch.lastErrorAt = null;
           patch.backoffLevel = 0;
         }
         runtime.repos.providers.patch(connection.id, { data: patch });
       }
       return c.json({ ok: true });
     })
       .post("/test", async (c) => {
         try {
           const body = await c.req.json<{ model?: string; kind?: string }>();
           if (!body.model) return c.json({ error: "Model required" }, 400);
           return c.json(await pingModelByKind(runtime, body.model, body.kind || "llm"));
         } catch (error: any) {
           // The probe never reached upstream, so no upstream code exists to
           // follow. Report 502 (bad gateway), not 500, with the real text.
           const message = error instanceof Error ? error.message : String(error);
           return c.json({ ok: false, latencyMs: 0, error: `HTTP 502: ${message}`, status: 502 });
         }
       })
      .get("/search", (c) => {
        const query = c.req.query("q") || "";
        const provider = c.req.query("provider") || "";
        const kind = c.req.query("kind") || "";
        const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
        return c.json({ models: searchModelCatalog(runtime, { query, provider, kind: kind || undefined, limit }) });
      })
      .get("/:kind", (c) => c.json({ object: "list", data: modelManagementCatalog(runtime).filter((model) => model.kind === c.req.param("kind")) }));
}
