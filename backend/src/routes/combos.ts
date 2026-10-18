import { Hono } from "hono";
import type { Runtime } from "../runtime";

function responseCombo(combo: Record<string, any>) {
  let capabilities: Record<string, unknown> = {};
  try { capabilities = JSON.parse(String(combo.capabilities || "{}")); } catch { capabilities = {}; }
  return { ...combo, models: JSON.parse(String(combo.models || "[]")), accountFilters: JSON.parse(String(combo.accountFilters || combo.account_filters || "{}")), capabilities, useCustomAccountOrder: combo.useCustomAccountOrder === true || combo.useCustomAccountOrder === 1 };
}

export function comboRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", (c) => c.json({ combos: runtime.repos.combos.list().map(responseCombo) }))
    .post("/", async (c) => { const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>)); const name = typeof body.name === "string" ? body.name.trim() : ""; if (!name) return c.json({ error: "Name is required" }, 400); if (!/^[a-zA-Z0-9_.\-:]+$/.test(name)) return c.json({ error: "Name can only contain letters, numbers, -, _, . and :" }, 400); if (!Array.isArray(body.models)) return c.json({ error: "Models are required" }, 400); try { return c.json(runtime.repos.combos.create({ ...body, name, models: body.models }), 201); } catch { return c.json({ error: "Combo name already exists" }, 400); } })
    .get("/:id", (c) => { const combo = runtime.repos.combos.get(c.req.param("id")); return combo ? c.json(responseCombo(combo)) : c.json({ error: "Combo not found" }, 404); })
    .post("/:id/consumers", async (c) => {
      const combo = runtime.repos.combos.get(c.req.param("id"));
      if (!combo) return c.json({ error: "Combo not found" }, 404);
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      const keyIds = Array.isArray(body.keyIds) ? body.keyIds.filter((value): value is string => typeof value === "string") : [];
      const allowed = new Set(keyIds);
      const comboName = String(combo.name);
      let updated = 0;
      // Participant keys inherit combo access from their event parent.
      for (const key of runtime.repos.keys.list().filter((item) => !item.parentId)) {
        const mode = key.comboAccessMode === "whitelist" ? "whitelist" : "blacklist";
        const list = Array.isArray(key.comboAccessList) ? key.comboAccessList : [];
        const listed = list.includes(comboName);
        const shouldList = mode === "whitelist" ? allowed.has(key.id) : !allowed.has(key.id);
        if (listed === shouldList) continue;
        runtime.repos.keys.update(key.id, { comboAccessList: shouldList ? [...list, comboName] : list.filter((name) => name !== comboName) });
        updated += 1;
      }
      return c.json({ updated });
    })
    .put("/:id", async (c) => { const combo = runtime.repos.combos.update(c.req.param("id"), await c.req.json<Record<string, unknown>>()); return combo ? c.json(responseCombo(combo)) : c.json({ error: "Combo not found" }, 404); })
    .delete("/:id", (c) => runtime.repos.combos.remove(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Combo not found" }, 404));
}
