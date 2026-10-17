import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { getProviderCatalog, getProviderMetadata } from "../services/providers/providerCatalog";
import { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits, isAuthExpiredResult, refreshCodexConnection } from "../services/billing/codexCredits";
import { usageTokenCounts, type UsageTrendBy } from "../db/repositories";
import { InvalidUsageCursor } from "../db/usageQueries";
import { readAutoclawClaims, runAutoclawClaimForConnection, type AutoclawClaimId } from "../services/billing/autoclawTasksScheduler";
import { listInspirationCenter, runInspirationAllLanguagesForConnection, runInspirationCenterForConnection, runInspirationItemForConnection } from "../services/billing/autoclawTasksScheduler";
import { normalizeInspirationLanguage } from "../services/billing/autoclawTasks";
import { readCodebuddyProbe, runCodebuddyProbeForConnection } from "../services/providers/codebuddyProbeScheduler";
import { bindInviteForConnection, bindInviteForConnections } from "../services/providers/codebuddyInviteBind";
import { runInviteChainForConnection, runInviteChainForConnections, normalizeProxyPoolId } from "../services/providers/codebuddyInviteChain";
import { reportAgentTaskForConnection } from "../services/providers/codebuddyTaskReport";
import { runWebchatForConnection } from "../services/providers/codebuddyWebchat";
import { clearConnectionLocks } from "../services/chat/credentials";
import { runUsageRetention } from "../services/platform/usageRetention";

const PERIODS = new Set(["today", "1h", "24h", "7d", "30d", "60d", "all"]);
const TREND_DIMENSIONS = new Set(["provider", "account", "model", "combo", "apiKey"]);
// Only API keys can have zero usage, because every other entity is built from usage rows.
const ACTIVITY_FILTERS = new Set(["all", "used", "unused"]);
const HEALTH_FILTERS = new Set(["all", "failing", "healthy"]);
const KEY_STATUS_FILTERS = new Set(["all", "active", "paused"]);
const EMPTY_KEY_USAGE = { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, failed: 0, lastUsed: null };

function period(value: string | undefined, fallback: string, valid = PERIODS): string | null {
  const selected = value || fallback;
  return valid.has(selected) ? selected : null;
}

function pageValue(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return !Number.isFinite(parsed) || parsed === 0 ? fallback : Math.max(1, Math.floor(parsed));
}

function formatLogDate(value: string): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (Number.isNaN(date.getTime())) return value;
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// v1 renders the request log as pipe-separated rows derived from usage history.
function recentRequestLogs(runtime: Runtime, limit = 200): string[] {
  const rows = runtime.repos.usage.list(limit);
  if (!rows.length) return [];
  const names = new Map(runtime.repos.providers.list(true).map((connection) => [connection.id, connection.name || connection.email || ""]));
  return rows.map((row) => {
    const timestamp = String(row.timestamp || "");
    const provider = String(row.provider || "-").toUpperCase() || "-";
    const model = String(row.model || "-");
    const connectionId = row.connection_id == null ? "" : String(row.connection_id);
    const account = names.get(connectionId) || (connectionId ? connectionId.slice(0, 8) : "-");
    const tokens = row.tokens && typeof row.tokens === "object" ? row.tokens as Record<string, unknown> : {};
    const sent = Number(row.prompt_tokens ?? tokens.prompt_tokens ?? 0) || "-";
    const received = Number(row.completion_tokens ?? tokens.completion_tokens ?? 0) || "-";
    return `${formatLogDate(timestamp)} | ${model} | ${provider} | ${account} | ${sent} | ${received} | ${String(row.status || "-")}`;
  });
}

// Lightweight live-stats snapshot v1 pushes on pending changes.
function activeRequestsState(runtime: Runtime) {
  const connections = runtime.repos.providers.list(true);
  const connectionNames = new Map(connections.map((connection) => [connection.id, connection.name || connection.email || `Account ${connection.id.slice(0, 8)}...`]));
  const keyNames = new Map(runtime.repos.keys.list().map((key) => [String(key.key), key.name || key.keyPrefix || "API Key"]));
  const detailRows = runtime.repos.usage.requestDetails({ page: 1, pageSize: 100 }).details;
  const usedDetailIds = new Set<string>();

  const activeRequests: Array<Record<string, unknown>> = [];
  for (const [connectionId, models] of runtime.repos.usage.pendingSnapshot()) {
    for (const [modelKey, count] of models) {
      if (count > 0) {
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: connectionNames.get(connectionId) || `Account ${connectionId.slice(0, 8)}...`,
          count,
        });
      }
    }
  }

  const seen = new Set<string>();
  const recentRequests = runtime.repos.usage.list(200)
    .map((row) => {
      const meta = row.meta && typeof row.meta === "object" ? row.meta as Record<string, unknown> : {};
      const apiKeyId = row.api_key_id == null ? "" : String(row.api_key_id);
       const detail = detailRows.find((candidate) => {
         const candidateId = candidate.id == null ? "" : String(candidate.id);
         if (!candidateId || usedDetailIds.has(candidateId)) return false;
         return String(candidate.model || "") === String(row.model || "") && String(candidate.provider || "") === String(row.provider || "");
       });
       if (detail?.id != null) usedDetailIds.add(String(detail.id));
       const counts = usageTokenCounts(row);
       return {
         detailId: detail?.id || null,
         timestamp: row.timestamp,
        model: row.model,
        displayModel: row.provider && row.model ? fullModelName(`${String(row.provider)}/${String(row.model)}`) : String(row.model || ""),
        provider: row.provider || "",
        promptTokens: counts.promptTokens,
        completionTokens: counts.completionTokens,
        cachedTokens: counts.cachedTokens,
        comboName: meta.comboName || null,
        clientIp: row.client_ip || null,
        apiKeyName: apiKeyId ? keyNames.get(apiKeyId) || `Key ${apiKeyId.slice(0, 8)}` : null,
        status: row.status || "ok",
      };
    })
    .filter((entry) => {
      // Deduplicate identical requests within the same minute. Do NOT hide
      // zero-token requests — providers that omit usage metadata from their
      // SSE stream still represent real traffic the operator needs to see.
      const minute = entry.timestamp ? String(entry.timestamp).slice(0, 16) : "";
      const key = `${entry.model}|${entry.provider}|${entry.promptTokens}|${entry.completionTokens}|${entry.comboName || ""}|${entry.clientIp || ""}|${entry.apiKeyName || ""}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  return { activeRequests, recentRequests, errorProvider: runtime.repos.usage.errorProviderWindow() };
}

function providerNames(runtime: Runtime): Record<string, string> {
  const names: Record<string, string> = Object.fromEntries(getProviderCatalog().map((provider) => [provider.id, provider.name]));
  for (const connection of runtime.repos.providers.list(true)) {
    const metadata = getProviderMetadata(connection.provider);
    names[connection.provider] = metadata?.name || connection.name || connection.provider;
  }
  for (const node of runtime.repos.nodes.list()) {
    if (node.id && node.name) names[String(node.id)] = String(node.name);
  }
  for (const connection of runtime.repos.providers.list(true)) {
    if (connection.provider && connection.name && !names[connection.provider]) names[connection.provider] = connection.name;
  }
  return names;
}

function nameFor(names: Record<string, string>, id: string): string {
  return names[id] || id;
}

function fullModelName(id: string): string {
  const slash = id.indexOf("/");
  if (slash <= 0) return id;
  const provider = id.slice(0, slash);
  const model = id.slice(slash + 1);
  const prefix = getProviderMetadata(provider)?.alias || provider;
  return `${prefix}/${model}`;
}

function usageAggregate(usage: Record<string, unknown>): Record<string, unknown> {
  return {
    requests: usage.requests,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cost: usage.cost,
    failed: Number(usage.failed) || 0,
    lastUsed: usage.lastUsed,
  };
}

type SortKey = "requests" | "tokens" | "cost" | "recent" | "name";
const SORT_KEYS = new Set<SortKey>(["requests", "tokens", "cost", "recent", "name"]);

function sortParam(value: string | undefined): SortKey {
  return SORT_KEYS.has(value as SortKey) ? (value as SortKey) : "requests";
}

type SortableRow = { id: string; usage: Record<string, unknown> };

// Entity rows arrive ranked by requests. Re-rank only when the caller asks.
function sortUsageRows<T extends SortableRow>(rows: T[], key: SortKey, nameOf: (row: T) => string): T[] {
  const number = (value: unknown) => Number(value) || 0;
  const time = (value: unknown) => (value ? new Date(String(value)).getTime() || 0 : 0);
  const sorted = [...rows];
  sorted.sort((left, right) => {
    if (key === "name") return nameOf(left).localeCompare(nameOf(right));
    if (key === "tokens") return number(right.usage.totalTokens) - number(left.usage.totalTokens);
    if (key === "cost") return number(right.usage.cost) - number(left.usage.cost);
    if (key === "recent") return time(right.usage.lastUsed) - time(left.usage.lastUsed);
    return number(right.usage.requests) - number(left.usage.requests);
  });
  return sorted;
}

function filterByActivity<T extends SortableRow>(rows: T[], activity: string | undefined): T[] {
  if (!activity || !ACTIVITY_FILTERS.has(activity) || activity === "all") return rows;
  return rows.filter((row) => (Number(row.usage.requests) > 0) === (activity === "used"));
}

// "failing" keeps entities with at least one non-success request in the period.
function filterByHealth<T extends SortableRow>(rows: T[], health: string | undefined): T[] {
  if (!health || !HEALTH_FILTERS.has(health) || health === "all") return rows;
  return rows.filter((row) => (Number(row.usage.failed) > 0) === (health === "failing"));
}

function paginatedUsageRows(
  rows: Array<{ id: string; usage: Record<string, unknown> }>,
  page: number,
  pageSize: number,
  nameForId: (id: string) => string,
): { items: Array<{ id: string; name: string; usage: Record<string, unknown> }>; pagination: Record<string, number> } {
  const total = rows.length;
  const start = (page - 1) * pageSize;
  const items = rows.slice(start, start + pageSize).map((row) => ({ id: row.id, name: nameForId(row.id), usage: usageAggregate(row.usage) }));
  return { items, pagination: { page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

export function usageRoutes(runtime: Runtime) {
  const route = new Hono().use("*", runtime.auth.adminMiddleware());

  route
    // Process health for operators and the load-test harness: event-loop lag, memory, slow SQLite queries.
    .get("/runtime-stats", (c) => c.json(runtime.metrics.snapshot()))
    .post("/runtime-stats/reset", (c) => {
      runtime.metrics.reset();
      return c.json({ success: true });
    })
    // Runs the Usage retention job now. It also runs every hour. With
    // usageRetentionDays unset or 0 it moves nothing.
    .post("/retention/run", async (c) => c.json(await runUsageRetention(runtime)))
    .get("/stats", (c) => {
      const selected = period(c.req.query("period"), "7d");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      return c.json(runtime.repos.usage.summary(selected));
    })
    .get("/history", (c) => {
      try {
        return c.json(runtime.repos.usage.history({ limit: pageValue(c.req.query("limit"), 100), cursor: c.req.query("cursor") || null }));
      } catch (error) {
        if (error instanceof InvalidUsageCursor) return c.json({ error: "Invalid cursor" }, 400);
        throw error;
      }
    })
    .get("/request-details", (c) => {
      const page = Number(c.req.query("page"));
      const pageSize = Number(c.req.query("pageSize"));
      if (page && page < 1) return c.json({ error: "Page must be >= 1" }, 400);
      if (pageSize && (pageSize < 1 || pageSize > 100)) return c.json({ error: "PageSize must be between 1 and 100" }, 400);
      const result = runtime.repos.usage.requestDetails({ page, pageSize, provider: c.req.query("provider"), model: c.req.query("model"), connectionId: c.req.query("connectionId"), status: c.req.query("status"), outcome: c.req.query("outcome"), search: c.req.query("search"), startDate: c.req.query("startDate"), endDate: c.req.query("endDate") });
      return c.json({
        ...result,
        details: (result.details || []).map((detail) => ({
          ...detail,
          displayModel: detail.provider && detail.model ? fullModelName(`${String(detail.provider)}/${String(detail.model)}`) : String(detail.model || ""),
        })),
      });
    })
     .get("/request-details/:id", (c) => {
       const detail = runtime.repos.usage.requestDetail(c.req.param("id"));
       return detail ? c.json(detail) : c.json({ error: "Request detail not found" }, 404);
     })
    .get("/logs", (c) => c.json(runtime.repos.usage.list(200)))
    .get("/dashboard", (c) => {
       const selected = period(c.req.query("period"), "7d");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      c.header("Cache-Control", "no-store");
      return c.json(runtime.repos.usage.dashboard(selected));
    })
    .get("/chart", (c) => {
      const selected = period(c.req.query("period"), "7d");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      return c.json(runtime.repos.usage.chart(selected));
    })
    .get("/overview", (c) => {
      const selected = period(c.req.query("period"), "24h");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      const models = Math.min(50, pageValue(c.req.query("models"), 16));
      c.header("Cache-Control", "no-store");
      const overview = runtime.repos.usage.overview(selected, models);
      const known = providerNames(runtime);
      return c.json({
        ...overview,
        costByProvider: overview.costByProvider.map((item) => ({ ...item, name: nameFor(known, item.id) })),
        models: overview.models.map((item) => ({ ...item, name: fullModelName(item.id) })),
      });
    })
    .get("/trend", (c) => {
      const selected = period(c.req.query("period"), "7d");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      const by = c.req.query("by") || "";
      if (!TREND_DIMENSIONS.has(by)) return c.json({ error: "Invalid trend dimension" }, 400);
      const top = Math.min(10, pageValue(c.req.query("top"), 5));
      c.header("Cache-Control", "no-store");
      const trend = runtime.repos.usage.trend(by as UsageTrendBy, selected, top);
      const names: Record<string, string> = {};
      if (by === "provider") {
        const known = providerNames(runtime);
        for (const item of trend.series) names[item.id] = nameFor(known, item.id);
      } else if (by === "account") {
        for (const connection of runtime.repos.providers.list(true)) names[connection.id] = connection.name || connection.email || connection.id;
      } else if (by === "model") {
        for (const item of trend.series) names[item.id] = fullModelName(item.id);
      } else if (by === "apiKey") {
        // Usage rows store the raw key value. Never send it to the browser: swap it for the key id.
        const byValue = new Map(runtime.repos.keys.list().map((key) => [key.key, key]));
        let removed = 0;
        for (const item of trend.series) {
          if (item.id === "unknown" || item.id === "__other__") {
            if (item.id === "unknown") names[item.id] = "No key";
            continue;
          }
          const record = byValue.get(item.id);
          // Each deleted key still gets its own series, with a stable placeholder id.
          item.id = record ? record.id : `removed-${++removed}`;
          names[item.id] = record ? record.name || `${record.keyPrefix || "sk"}...` : `Removed key ${removed}`;
        }
      }
      return c.json({ ...trend, names });
    })
    .get("/providers", (c) => {
      const names = providerNames(runtime);
      const providers = runtime.repos.usage.providerIds().map((id) => ({ id, name: nameFor(names, id) }));
      return c.json({ providers });
    })
    .get("/by-provider", (c) => {
      const selected = period(c.req.query("period"), "all");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      const names = providerNames(runtime);
      const page = pageValue(c.req.query("page"), 1);
      const pageSize = Math.min(1000, pageValue(c.req.query("pageSize"), 10));
      const search = (c.req.query("search") || "").trim().toLowerCase();
      let rows = runtime.repos.usage.providers(selected).map((item) => {
        const id = String(item.provider);
        return {
          id,
          name: nameFor(names, id),
          usage: {
            requests: item.requests,
            promptTokens: item.promptTokens,
            completionTokens: item.completionTokens,
            totalTokens: item.totalTokens,
            cost: item.cost,
            failed: Number(item.failed) || 0,
            lastUsed: item.lastUsed,
          },
        };
      });
      if (search) rows = rows.filter((row) => row.name.toLowerCase().includes(search) || row.id.toLowerCase().includes(search));
      rows = filterByHealth(rows, c.req.query("health"));
      rows = sortUsageRows(rows, sortParam(c.req.query("sort")), (row) => row.name);
      const total = rows.length;
      const start = (page - 1) * pageSize;
      return c.json({ providers: rows.slice(start, start + pageSize), pagination: { page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
    })
    .get("/by-provider/:id", (c) => {
      const selected = period(c.req.query("period"), "all");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      return c.json(runtime.repos.usage.statsForProvider(c.req.param("id"), selected, pageValue(c.req.query("recentLimit"), 30)));
    })
    .get("/by-account/:id", (c) => {
      const selected = period(c.req.query("period"), "all");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      return c.json(runtime.repos.usage.statsForAccount(c.req.param("id"), selected, pageValue(c.req.query("recentLimit"), 30)));
    })
    .get("/by-account", (c) => {
      const selected = period(c.req.query("period"), "all");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      const page = pageValue(c.req.query("page"), 1);
      const pageSize = Math.min(1000, pageValue(c.req.query("pageSize"), 10));
      const search = (c.req.query("search") || "").trim().toLowerCase();
      const names = new Map<string, string>();
      for (const connection of runtime.repos.providers.list(true)) names.set(connection.id, connection.name || connection.email || connection.id);
      let rows = runtime.repos.usage.accounts(selected);
      if (search) rows = rows.filter((row) => { const label = names.get(row.id) || row.id; return label.toLowerCase().includes(search) || row.id.toLowerCase().includes(search); });
      const providerFilter = (c.req.query("provider") || "").trim();
      if (providerFilter) {
        const owner = new Map(runtime.repos.providers.list(true).map((connection) => [connection.id, connection.provider]));
        rows = rows.filter((row) => owner.get(row.id) === providerFilter);
      }
      rows = filterByHealth(rows, c.req.query("health"));
      rows = sortUsageRows(rows, sortParam(c.req.query("sort")), (row) => names.get(row.id) || row.id);
      return c.json(paginatedUsageRows(rows, page, pageSize, (id) => names.get(id) || id));
    })
    .get("/by-model", (c) => {
      const selected = period(c.req.query("period"), "all");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      const page = pageValue(c.req.query("page"), 1);
      const pageSize = Math.min(1000, pageValue(c.req.query("pageSize"), 10));
      const search = (c.req.query("search") || "").trim().toLowerCase();
      let rows = runtime.repos.usage.models(selected);
      if (search) rows = rows.filter((row) => fullModelName(row.id).toLowerCase().includes(search) || row.id.toLowerCase().includes(search));
      const providerFilter = (c.req.query("provider") || "").trim();
      if (providerFilter) rows = rows.filter((row) => row.id.startsWith(`${providerFilter}/`));
      rows = filterByHealth(rows, c.req.query("health"));
      rows = sortUsageRows(rows, sortParam(c.req.query("sort")), (row) => fullModelName(row.id));
      return c.json(paginatedUsageRows(rows, page, pageSize, fullModelName));
    })
    .get("/by-combo", (c) => {
      const selected = period(c.req.query("period"), "all");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      const page = pageValue(c.req.query("page"), 1);
      const pageSize = Math.min(1000, pageValue(c.req.query("pageSize"), 10));
      const search = (c.req.query("search") || "").trim().toLowerCase();
      let rows = runtime.repos.usage.combos(selected);
      if (search) rows = rows.filter((row) => row.id.toLowerCase().includes(search));
      rows = filterByHealth(rows, c.req.query("health"));
      rows = sortUsageRows(rows, sortParam(c.req.query("sort")), (row) => row.id);
      return c.json(paginatedUsageRows(rows, page, pageSize, (id) => id));
    })
    .get("/api-keys", (c) => {
      const selected = period(c.req.query("period"), "all");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      const page = pageValue(c.req.query("page"), 1);
      const pageSize = Math.min(1000, pageValue(c.req.query("pageSize"), 10));
      const search = (c.req.query("search") || "").trim().toLowerCase();
      const status = c.req.query("status") || "all";
      const visibility = c.req.query("visibility") || "all";
      if (!KEY_STATUS_FILTERS.has(status)) return c.json({ error: "Invalid status filter" }, 400);
      const matched = runtime.repos.keys.list().filter((key) => {
        if (status === "active" && !key.isActive) return false;
        if (status === "paused" && key.isActive) return false;
        if (visibility !== "all" && key.visibility !== visibility) return false;
        if (!search) return true;
        return [key.name, key.id, key.keyPrefix].some((value) => value?.toLowerCase().includes(search));
      });
      // Usage is needed for every matched key so sorting and activity filters stay correct across pages.
      const usageByKey = runtime.repos.usage.apiKeys(matched.map((key) => key.key), selected);
      let ranked = matched.map((key) => ({ key, id: key.id, usage: (usageByKey[key.key] || EMPTY_KEY_USAGE) as Record<string, unknown> }));
      ranked = filterByActivity(ranked, c.req.query("activity"));
      ranked = filterByHealth(ranked, c.req.query("health"));
      ranked = sortUsageRows(ranked, sortParam(c.req.query("sort")), (row) => row.key.name || row.key.id);
      const total = ranked.length;
      const start = (page - 1) * pageSize;
      return c.json({
        keys: ranked.slice(start, start + pageSize).map(({ key, usage }) => ({
          id: key.id,
          name: key.name,
          key: `${key.keyPrefix || "sk"}...`,
          isActive: key.isActive,
          visibility: key.visibility,
          createdAt: key.createdAt,
          usage,
        })),
        pagination: { page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      });
    })
    .get("/api-keys/:id", (c) => {
      const key = runtime.repos.keys.list().find((item) => item.id === c.req.param("id"));
      if (!key) return c.json({ error: "API key not found" }, 404);
      const selected = period(c.req.query("period"), "all");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      return c.json(runtime.repos.usage.statsForApiKey(key.key, selected, pageValue(c.req.query("recentLimit"), 30)));
    })
    .get("/request-logs", (c) => {
      try {
        return c.json(recentRequestLogs(runtime, 200));
      } catch {
        return c.json({ error: "Failed to fetch logs" }, 500);
      }
    })
    .get("/stream", (c) => {
      const selected = period(c.req.query("period"), "all");
      if (!selected) return c.json({ error: "Invalid period" }, 400);
      const encoder = new TextEncoder();
      const state = { closed: false, keepalive: null as ReturnType<typeof setInterval> | null, send: null as (() => Promise<void>) | null, sendPending: null as (() => Promise<void>) | null, cachedStats: null as Record<string, unknown> | null };

      const cleanup = () => {
        if (state.send) runtime.repos.usage.events.off("update", state.send);
        if (state.sendPending) runtime.repos.usage.events.off("pending", state.sendPending);
        if (state.keepalive) clearInterval(state.keepalive);
      };

      const stream = new ReadableStream({
        async start(controller) {
          // Full stats refresh (heavy) + immediate lightweight push.
          state.send = async () => {
            if (state.closed) return;
            try {
              if (state.cachedStats) {
                const quick = { ...state.cachedStats, ...activeRequestsState(runtime) };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(quick)}\n\n`));
              }
               const stats = { ...runtime.repos.usage.summary(selected), ...activeRequestsState(runtime) };
              state.cachedStats = stats;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
            } catch {
              state.closed = true;
              cleanup();
            }
          };
          // Lightweight push: only refresh live request state on pending changes.
          state.sendPending = async () => {
            if (state.closed || !state.cachedStats) return;
            try {
              const quick = { ...state.cachedStats, ...activeRequestsState(runtime) };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(quick)}\n\n`));
            } catch {
              state.closed = true;
              cleanup();
            }
          };

          await state.send();
          runtime.repos.usage.events.on("update", state.send);
          runtime.repos.usage.events.on("pending", state.sendPending);

          state.keepalive = setInterval(() => {
            if (state.closed) { if (state.keepalive) clearInterval(state.keepalive); return; }
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              state.closed = true;
              if (state.keepalive) clearInterval(state.keepalive);
            }
          }, 25_000);
        },
        cancel() {
          state.closed = true;
          cleanup();
        },
      });

      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
    })
    .get("/:connectionId/codex-reset-credits", async (c) => {
      const connection = runtime.repos.providers.get(c.req.param("connectionId"));
      if (!connection) return c.json({ error: "Connection not found" }, 404);
      if (connection.provider !== "codex") return c.json({ error: "Codex reset credits are only available for Codex connections." }, 400);
      const isOAuth = connection.authType === "oauth";
      const isAccessToken = connection.authType === "access_token";
      if (!isOAuth && !isAccessToken) return c.json({ error: "Codex reset credits require an OAuth or access-token connection." }, 400);
      try {
        let current = connection;
        if (isOAuth) {
          const refreshed = await refreshCodexConnection(runtime, current);
          if ("error" in refreshed) return c.json({ error: refreshed.error }, 401);
          current = refreshed.connection;
        }
        try {
          return c.json(await getCodexRateLimitResetCredits(current));
        } catch (error: any) {
          if (!isOAuth || !current.data.refreshToken || !isAuthExpiredResult({ message: error instanceof Error ? error.message : String(error) })) throw error;
          const retry = await refreshCodexConnection(runtime, current, { afterAuthFailure: true });
          if ("error" in retry) throw new Error(retry.error);
          return c.json(await getCodexRateLimitResetCredits(retry.connection));
        }
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
      }
    })
    .post("/:connectionId/codex-reset-credits", async (c) => {
      const connection = runtime.repos.providers.get(c.req.param("connectionId"));
      if (!connection) return c.json({ error: "Connection not found" }, 404);
      if (connection.provider !== "codex") return c.json({ error: "Codex reset credits are only available for Codex connections." }, 400);
      const isOAuth = connection.authType === "oauth";
      const isAccessToken = connection.authType === "access_token";
      if (!isOAuth && !isAccessToken) return c.json({ error: "Codex reset credits require an OAuth or access-token connection." }, 400);
      try {
        let current = connection;
        if (isOAuth) {
          const refreshed = await refreshCodexConnection(runtime, current);
          if ("error" in refreshed) return c.json({ error: refreshed.error }, 401);
          current = refreshed.connection;
        }
        // Server-generated redeem id prevents client-controlled replay.
        const redeemRequestId = crypto.randomUUID();
        let consumeResult = await consumeCodexRateLimitResetCredit(current, redeemRequestId);
        if (isOAuth && isAuthExpiredResult(consumeResult) && current.data.refreshToken) {
          try {
            const retry = await refreshCodexConnection(runtime, current, { afterAuthFailure: true });
            if (!("error" in retry)) {
              consumeResult = await consumeCodexRateLimitResetCredit(retry.connection, redeemRequestId);
            }
          } catch { /* keep the original consume result */ }
        }
        if (consumeResult.ok) {
          // Upstream windows reset, so drop the stale local rate-limit locks.
          // Without this the old modelLock_* timestamp keeps blocking
          // requests until the pre-reset time passes.
          clearConnectionLocks(runtime, current.id);
          return c.json({ code: consumeResult.code, reset: true, windows_reset: consumeResult.windowsReset, redeemRequestId, credit: (consumeResult.raw as { credit?: unknown } | null)?.credit || null });
        }
        if (consumeResult.noCredit) {
          return c.json({ code: "no_credit", reset: false, windows_reset: consumeResult.windowsReset, message: "No Codex reset credits available." }, 409);
        }
        return c.json({
          code: consumeResult.code || "unknown_response",
          reset: false,
          windows_reset: consumeResult.windowsReset,
          message: consumeResult.message || "Codex reset credit consume returned an unexpected response.",
        }, (consumeResult.status >= 400 && consumeResult.status < 500 ? consumeResult.status : 502) as 400 | 401 | 402 | 403 | 404 | 409 | 429 | 500 | 502);
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
      }
    })
    .post("/:connectionId/clear-cooldown", async (c) => {
      const connectionId = c.req.param("connectionId");
      if (!runtime.repos.providers.get(connectionId)) return c.json({ error: "Connection not found" }, 404);
      // Manual wait-window reset. Drops stale modelLock_* timestamps without
      // spending a reset credit or touching upstream quota.
      const cleared = clearConnectionLocks(runtime, connectionId);
      if (!cleared) return c.json({ error: "Connection not found" }, 404);
      return c.json({ cleared: true });
    })
    .get("/autoclaw-tasks/:connectionId", (c) => {
      const connectionId = c.req.param("connectionId");
      const connection = runtime.repos.providers.get(connectionId);
      if (!connection) return c.json({ error: "Connection not found" }, 404);
      if (connection.provider !== "autoclaw") return c.json({ error: "AutoClaw tasks are only available for AutoClaw connections." }, 400);
      return c.json({
        claims: readAutoclawClaims(runtime, connectionId),
        tasks: runtime.repos.autoclawTasks.listByConnection(connectionId),
      });
    })
    .post("/autoclaw-tasks/:connectionId/claim/:claimId", async (c) => {
      const connectionId = c.req.param("connectionId");
      const claimId = c.req.param("claimId") as AutoclawClaimId;
      const connection = runtime.repos.providers.get(connectionId);
      if (!connection) return c.json({ error: "Connection not found" }, 404);
      if (connection.provider !== "autoclaw") return c.json({ error: "AutoClaw tasks are only available for AutoClaw connections." }, 400);
      if (claimId !== "daily_signin" && claimId !== "fission_login_reward" && claimId !== "inspiration_center") {
        return c.json({ error: "Unknown AutoClaw claim type." }, 400);
      }
      const result = await runAutoclawClaimForConnection(runtime, connectionId, claimId);
      return c.json(result);
    })
    .get("/inspiration-center/:connectionId", async (c) => {
      const connectionId = c.req.param("connectionId");
      const connection = runtime.repos.providers.get(connectionId);
      if (!connection) return c.json({ error: "Connection not found" }, 404);
      if (connection.provider !== "autoclaw") return c.json({ error: "Inspiration center is only available for AutoClaw connections." }, 400);
      try {
        const language = normalizeInspirationLanguage(c.req.query("language"));
        const items = await listInspirationCenter(runtime, connectionId, language);
        return c.json({ items, language });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
      }
    })
    .post("/inspiration-center/:connectionId/claim", async (c) => {
      const connectionId = c.req.param("connectionId");
      const connection = runtime.repos.providers.get(connectionId);
      if (!connection) return c.json({ error: "Connection not found" }, 404);
      if (connection.provider !== "autoclaw") return c.json({ error: "Inspiration center is only available for AutoClaw connections." }, 400);
      const body = await c.req.json<{ inspiration_id?: unknown; language?: unknown }>().catch(() => ({} as { inspiration_id?: unknown; language?: unknown }));
      const inspirationId = typeof body.inspiration_id === "string" ? body.inspiration_id : "";
      if (!inspirationId) return c.json({ error: "Unknown inspiration." }, 400);
      const result = await runInspirationItemForConnection(runtime, connectionId, inspirationId, body.language);
      return c.json(result);
    })
    .post("/inspiration-center/:connectionId/claim-all", async (c) => {
      const connectionId = c.req.param("connectionId");
      const connection = runtime.repos.providers.get(connectionId);
      if (!connection) return c.json({ error: "Connection not found" }, 404);
      if (connection.provider !== "autoclaw") return c.json({ error: "Inspiration center is only available for AutoClaw connections." }, 400);
      const body = await c.req.json<{ language?: unknown }>().catch(() => ({} as { language?: unknown }));
      const language = typeof body.language === "string" ? body.language.trim().toLowerCase() : "";
      if (language === "all") {
        const result = await runInspirationAllLanguagesForConnection(runtime, connectionId);
        return c.json(result);
      }
      const result = await runInspirationCenterForConnection(runtime, connectionId, body.language);
      return c.json(result);
    })
    .get("/codebuddy-probe/:connectionId", (c) => {
      const connectionId = c.req.param("connectionId");
      const connection = runtime.repos.providers.get(connectionId);
      if (!connection) return c.json({ error: "Connection not found" }, 404);
      if (connection.provider !== "codebuddy-intl-cli") return c.json({ error: "Daily probe is only available for CodeBuddy intl CLI connections." }, 400);
      return c.json({
        probe: readCodebuddyProbe(runtime, connectionId),
        records: runtime.repos.autoclawTasks.listByConnection(connectionId).filter((record) => record.taskId === "daily_probe"),
      });
    })
    .post("/codebuddy-probe/:connectionId/run", async (c) => {
      const connectionId = c.req.param("connectionId");
      const connection = runtime.repos.providers.get(connectionId);
      if (!connection) return c.json({ error: "Connection not found" }, 404);
      if (connection.provider !== "codebuddy-intl-cli") return c.json({ error: "Daily probe is only available for CodeBuddy intl CLI connections." }, 400);
      const result = await runCodebuddyProbeForConnection(runtime, connectionId);
      return c.json(result);
    })
    .post("/codebuddy-invite/:connectionId/bind", async (c) => {
      const connectionId = c.req.param("connectionId");
      const body = await c.req.json<{ inviteCode?: unknown }>().catch(() => ({} as { inviteCode?: unknown }));
      const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
      if (!inviteCode) return c.json({ error: "Invite code is required" }, 400);
      const result = await bindInviteForConnection(runtime, connectionId, inviteCode);
      return c.json(result, result.ok ? 200 : 400);
    })
    .post("/codebuddy-invite/bind-bulk", async (c) => {
      const body = await c.req.json<{ inviteCode?: unknown; connectionIds?: unknown }>().catch(() => ({} as { inviteCode?: unknown; connectionIds?: unknown }));
      const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
      const connectionIds = Array.isArray(body.connectionIds) ? body.connectionIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
      if (!inviteCode) return c.json({ error: "Invite code is required" }, 400);
      if (!connectionIds.length) return c.json({ error: "No connections selected" }, 400);
      if (connectionIds.length > 200) return c.json({ error: "Too many IDs (max 200)" }, 400);
      const result = await bindInviteForConnections(runtime, connectionIds, inviteCode);
      return c.json(result);
    })
    .post("/codebuddy-invite/:connectionId/chain", async (c) => {
      const connectionId = c.req.param("connectionId");
      const body = await c.req.json<{ inviteCode?: unknown; proxyPoolId?: unknown }>().catch(() => ({} as { inviteCode?: unknown; proxyPoolId?: unknown }));
      const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
      if (!inviteCode) return c.json({ error: "Invite code is required" }, 400);
      const result = await runInviteChainForConnection(runtime, connectionId, inviteCode, { proxyPoolId: normalizeProxyPoolId(body.proxyPoolId) });
      return c.json(result, result.ok ? 200 : 400);
    })
    .post("/codebuddy-invite/chain-bulk", async (c) => {
      const body = await c.req.json<{ inviteCode?: unknown; connectionIds?: unknown; proxyPoolId?: unknown }>().catch(() => ({} as { inviteCode?: unknown; connectionIds?: unknown; proxyPoolId?: unknown }));
      const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
      const connectionIds = Array.isArray(body.connectionIds) ? body.connectionIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
      if (!inviteCode) return c.json({ error: "Invite code is required" }, 400);
      if (!connectionIds.length) return c.json({ error: "No connections selected" }, 400);
      if (connectionIds.length > 200) return c.json({ error: "Too many IDs (max 200)" }, 400);
      const result = await runInviteChainForConnections(runtime, connectionIds, inviteCode, { proxyPoolId: normalizeProxyPoolId(body.proxyPoolId) });
      return c.json(result);
    })
    .post("/codebuddy-report/:connectionId/task", async (c) => {
      const connectionId = c.req.param("connectionId");
      const result = await reportAgentTaskForConnection(runtime, connectionId);
      return c.json(result, result.ok ? 200 : 400);
    })
    .post("/codebuddy-webchat/:connectionId", async (c) => {
      const connectionId = c.req.param("connectionId");
      const body = await c.req.json<{ prompt?: unknown; model?: unknown }>().catch(() => ({} as { prompt?: unknown; model?: unknown }));
      const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
      const model = typeof body.model === "string" ? body.model : undefined;
      const result = await runWebchatForConnection(runtime, connectionId, { prompt, model });
      return c.json(result, result.ok ? 200 : 400);
    })
    .get("/batch", (c) => {
      const idsParam = c.req.query("ids") || "";
      const ids = idsParam.split(",").map((id) => id.trim()).filter(Boolean);
      if (ids.length === 0) return c.json({ results: {} });
      if (ids.length > 200) return c.json({ error: "Too many IDs (max 200)" }, 400);
      const results: Record<string, { ok: true; data: Record<string, unknown> } | { ok: false; error: string }> = {};
      for (const id of ids) {
        const connection = runtime.repos.providers.get(id);
        if (!connection) {
          results[id] = { ok: false, error: "Connection not found" };
          continue;
        }
        try {
          results[id] = { ok: true, data: runtime.quotaSnapshots.getPayload(id) };
        } catch (error: any) {
          results[id] = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
      return c.json({ results });
    })
    // Refresh only connections whose snapshot is stale (missing, error, or
    // past due). Pages call this on mount so a visit surfaces current numbers
    // without forcing an upstream fetch for connections that are still fresh.
    .post("/stale/refresh", async (c) => {
      const idsParam = c.req.query("ids") || "";
      const ids = idsParam.split(",").map((id) => id.trim()).filter(Boolean);
      if (ids.length === 0) return c.json({ results: {} });
      if (ids.length > 200) return c.json({ error: "Too many IDs (max 200)" }, 400);
      const settled = await Promise.allSettled(
        ids.map(async (id) => {
          const connection = runtime.repos.providers.get(id);
          if (!connection) throw new Error("Connection not found");
          await runtime.quotaSnapshots.refreshStale([id]);
          return runtime.quotaSnapshots.getPayload(id);
        }),
      );
      const results: Record<string, { ok: true; data: Record<string, unknown> } | { ok: false; error: string }> = {};
      ids.forEach((id, index) => {
        const outcome = settled[index];
        if (outcome.status === "fulfilled") {
          results[id] = { ok: true, data: outcome.value };
        } else {
          results[id] = { ok: false, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) };
        }
      });
      return c.json({ results });
    })
    .post("/batch/refresh", async (c) => {
      const idsParam = c.req.query("ids") || "";
      const ids = idsParam.split(",").map((id) => id.trim()).filter(Boolean);
      if (ids.length === 0) return c.json({ results: {} });
      if (ids.length > 200) return c.json({ error: "Too many IDs (max 200)" }, 400);
      const settled = await Promise.allSettled(
        ids.map(async (id) => {
          const connection = runtime.repos.providers.get(id);
          if (!connection) throw new Error("Connection not found");
          await runtime.quotaSnapshots.requestRefresh(id);
          return runtime.quotaSnapshots.getPayload(id);
        }),
      );
      const results: Record<string, { ok: true; data: Record<string, unknown> } | { ok: false; error: string }> = {};
      ids.forEach((id, index) => {
        const outcome = settled[index];
        if (outcome.status === "fulfilled") {
          results[id] = { ok: true, data: outcome.value };
        } else {
          results[id] = { ok: false, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) };
        }
      });
      return c.json({ results });
    })
    .post("/:connectionId/refresh", async (c) => {
      const connectionId = c.req.param("connectionId");
      if (!runtime.repos.providers.get(connectionId)) return c.json({ error: "Connection not found" }, 404);
      await runtime.quotaSnapshots.requestRefresh(connectionId);
      return c.json(runtime.quotaSnapshots.getPayload(connectionId));
    })
    // Parameterized connection routes stay last so static siblings match first.
    .get("/:connectionId", (c) => {
      const connectionId = c.req.param("connectionId");
      if (!runtime.repos.providers.get(connectionId)) return c.json({ error: "Connection not found" }, 404);
      return c.json(runtime.quotaSnapshots.getPayload(connectionId));
    });

  return route;
}
