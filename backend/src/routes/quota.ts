import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { isQuotaEligible, normalizeProviderQuota, type ConnectionQuota } from "../services/billing/quota";

export function quotaRoutes(runtime: Runtime) {
  const route = new Hono().use("*", runtime.auth.adminMiddleware());
  const load = (id: string): ConnectionQuota | null => {
    const connection = runtime.repos.providers.get(id);
    if (!connection) return null;
    const snapshot = runtime.quotaSnapshots.getSnapshot(id);
    const normalized = normalizeProviderQuota(snapshot?.payload || {});
    return {
      id: connection.id,
      provider: connection.provider,
      name: connection.name || connection.email || connection.id,
      email: connection.email,
      isActive: connection.isActive,
      authType: connection.authType,
      ...normalized,
      error: snapshot?.lastError || null,
      fetchedAt: snapshot?.fetchedAt || null,
    };
  };

  route.get("/", (c) => {
    const accounts = runtime.repos.providers.list(true).filter(isQuotaEligible).map((connection) => load(connection.id)!);
    const grouped = new Map<string, typeof accounts>();
    for (const account of accounts) {
      const group = grouped.get(account.provider) || [];
      group.push(account);
      grouped.set(account.provider, group);
    }
    return c.json({ providers: [...grouped.entries()].map(([provider, connections]) => ({ provider, connections })) });
  });
  route.get("/connections/:id", (c) => {
    const account = load(c.req.param("id"));
    return account ? c.json({ account }) : c.json({ error: "Connection not found" }, 404);
  });
  route.post("/connections/:id/refresh", async (c) => {
    const id = c.req.param("id");
    if (!runtime.repos.providers.get(id)) return c.json({ error: "Connection not found" }, 404);
    await runtime.quotaSnapshots.requestRefresh(id);
    const account = load(id);
    return account ? c.json({ account }) : c.json({ error: "Connection not found" }, 404);
  });
  return route;
}
