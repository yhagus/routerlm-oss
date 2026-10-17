const REGISTRY_URL = "https://api.anthropic.com/mcp-registry/v0/servers";
const VISIBILITY = "commercial,gsuite,gsuite-google";
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache: { timestamp: number; data: { servers: Record<string, unknown>[]; total: number } | null } = { timestamp: 0, data: null };

function directConnect(url: unknown): url is string {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return false;
  if (/mcp\.claude\.com|api\.anthropic\.com\/mcp/i.test(url)) return false;
  return !/[<{]/.test(url);
}

export function validateMcpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function fetchMcpRegistry(force = false): Promise<{ cached: boolean; servers: Record<string, unknown>[]; total: number }> {
  if (!force && cache.data && Date.now() - cache.timestamp < CACHE_TTL_MS) return { cached: true, ...cache.data };
  const servers: Record<string, unknown>[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const url = `${REGISTRY_URL}?limit=500&visibility=${VISIBILITY}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) break;
    const payload = await response.json() as Record<string, unknown>;
    const items = Array.isArray(payload.servers) ? payload.servers : [];
    for (const entry of items) {
      const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      const server = item.server && typeof item.server === "object" ? item.server as Record<string, unknown> : {};
      const metadataRoot = item._meta && typeof item._meta === "object" ? item._meta as Record<string, unknown> : {};
      const metadata = metadataRoot["com.anthropic.api/mcp-registry"] && typeof metadataRoot["com.anthropic.api/mcp-registry"] === "object"
        ? metadataRoot["com.anthropic.api/mcp-registry"] as Record<string, unknown>
        : {};
      const remotes = Array.isArray(server.remotes) ? server.remotes : [];
      const remote = remotes[0] && typeof remotes[0] === "object" ? remotes[0] as Record<string, unknown> : {};
      if (!directConnect(remote.url) || (Array.isArray(metadata.requiredFields) && metadata.requiredFields.length > 0)) continue;
      const toolNames = Array.isArray(metadata.toolNames) ? metadata.toolNames.filter((value): value is string => typeof value === "string") : [];
      servers.push({
        name: server.name,
        slug: metadata.slug || server.name,
        title: server.title || metadata.displayName || server.name,
        description: server.description || metadata.oneLiner || "",
        url: remote.url,
        transport: remote.type === "sse" ? "sse" : "http",
        oauth: !metadata.isAuthless,
        toolNames,
        toolCount: toolNames.length,
        iconUrl: metadata.iconUrl || null,
      });
    }
    const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata as Record<string, unknown> : {};
    cursor = typeof metadata.nextCursor === "string" ? metadata.nextCursor : "";
    if (!cursor) break;
  }
  const seen = new Set<string>();
  const unique = servers.filter((server) => {
    const url = String(server.url || "");
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  cache.timestamp = Date.now();
  cache.data = { servers: unique, total: unique.length };
  return { cached: false, ...cache.data };
}

function parseSseJson(text: string, id: number): Record<string, unknown> | null {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const value = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      if (value.id === id && value.result) return value;
    } catch {
      // Ignore non-JSON SSE comments and events.
    }
  }
  return null;
}

export async function probeMcp(value: unknown): Promise<Record<string, unknown>> {
  const url = validateMcpUrl(value);
  if (!url) return { error: "A valid http(s) MCP URL is required", tools: [] as any[]};
  const headers: Record<string, any> = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const initialize = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} as Record<string, any>, clientInfo: { name: "lobakai-v2", version: "2" } } }),
      signal: controller.signal,
    });
    if (initialize.status === 401 || initialize.status === 403) return { requiresAuth: true, tools: [] as any[]};
    if (!initialize.ok) return { error: `init ${initialize.status}`, tools: [] as any[]};
    const sessionId = initialize.headers.get("mcp-session-id");
    await initialize.text().catch(() => "");
    const listHeaders = { ...headers, ...(sessionId ? { "mcp-session-id": sessionId } : {}) };
    await fetch(url, { method: "POST", headers: listHeaders, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }), signal: controller.signal }).catch(() => undefined);
    const listed = await fetch(url, { method: "POST", headers: listHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }), signal: controller.signal });
    if (listed.status === 401 || listed.status === 403) return { requiresAuth: true, tools: [] as any[]};
    const contentType = listed.headers.get("content-type") || "";
    const parsed = contentType.includes("text/event-stream")
      ? parseSseJson(await listed.text(), 2)
      : await listed.json().catch(() => null) as Record<string, unknown> | null;
    const result = parsed?.result && typeof parsed.result === "object" ? parsed.result as Record<string, unknown> : {};
    const tools = Array.isArray(result.tools) ? result.tools : [];
    return { tools: tools.map((tool) => { const item = tool && typeof tool === "object" ? tool as Record<string, unknown> : {}; return { name: item.name, description: item.description || "" }; }) };
  } catch (error: any) {
    return { error: error instanceof DOMException && error.name === "AbortError" ? "timeout" : error instanceof Error ? error.message : "Probe failed", tools: [] as any[]};
  } finally {
    clearTimeout(timeout);
  }
}
