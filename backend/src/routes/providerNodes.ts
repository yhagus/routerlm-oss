import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { assertPublicUrl } from "../services/platform/shared/utils/ssrfGuard.ts";
import { getProviderByAlias } from "../services/platform/shared/constants/providers.ts";
import { getProviderMetadata } from "../services/providers/providerCatalog";

type NodeType = "openai-compatible" | "anthropic-compatible" | "custom-embedding";

function normalizeBaseUrl(type: NodeType, value: unknown): string {
  let baseUrl = String(value || (type === "anthropic-compatible" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1")).trim();
  if (type === "anthropic-compatible") baseUrl = baseUrl.replace(/\/$/, "").replace(/\/messages$/, "");
  if (type === "custom-embedding") baseUrl = baseUrl.replace(/\/$/, "").replace(/\/embeddings$/, "");
  return baseUrl;
}

// Lowercase slug: it is used in URLs, logs and as the connection provider id.
const NODE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
// "new" collides with the dashboard route /dashboard/providers/new.
const RESERVED_NODE_IDS = new Set(["new"]);

function nodeIdError(runtime: Runtime, id: string): { error: string; status: 400 | 409 } | null {
  if (!NODE_ID_PATTERN.test(id)) return { error: "ID must be 1-64 characters: lowercase letters, digits, '-' or '_', starting and ending with a letter or digit", status: 400 };
  if (RESERVED_NODE_IDS.has(id) || getProviderMetadata(id) || getProviderByAlias(id)) return { error: `ID "${id}" is reserved by a built-in provider`, status: 400 };
  if (runtime.repos.nodes.get(id)) return { error: `ID "${id}" is already in use`, status: 409 };
  return null;
}

function validType(value: unknown): value is NodeType {
  return value === "openai-compatible" || value === "anthropic-compatible" || value === "custom-embedding";
}

function isLocalRequest(request: Request): boolean {
  if (request.headers.get("x-lobak-via-proxy")) return false;
  const value = request.headers.get("x-lobak-real-ip") || request.headers.get("host") || new URL(request.url).host;
  const host = value === "::1" ? value : (value.startsWith("[") ? value.slice(1, value.indexOf("]")) : value.split(":")[0]).toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function modelsError(status: number): string {
  if (status === 401 || status === 403) return "API key unauthorized";
  if (status === 404) return "/models endpoint not found - try chat validation with model ID";
  if (status >= 500) return "Server error - try again later";
  return `Unexpected response (${status})`;
}

function chatError(status: number): string {
  if (status === 401 || status === 403) return "API key unauthorized";
  if (status === 400) return "Invalid model or bad request";
  if (status === 404) return "Chat endpoint not found";
  if (status >= 500) return "Server error - try again later";
  return `Chat request failed (${status})`;
}

function networkError(error: unknown): string {
  const cause = error instanceof Error && error.cause && typeof error.cause === "object" ? error.cause as { code?: string } : undefined;
  const code = cause?.code;
  if (code === "ECONNREFUSED") return "Connection refused - provider node offline or unreachable";
  if (code === "ENOTFOUND") return "DNS lookup failed - invalid domain or network issue";
  if (code === "ETIMEDOUT") return "Connection timeout - provider node too slow";
  if (error instanceof Error && error.message.toLowerCase().includes("timeout")) return "Request timeout (>10s) - provider node not responding";
  if (code === "CERT_HAS_EXPIRED") return "SSL certificate expired";
  if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return "SSL certificate verification failed";
  if (code) return `Network error: ${code}`;
  return "Network connection failed - check URL and network connectivity";
}

async function probe(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

export function providerNodeRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", (c) => c.json({ nodes: runtime.repos.nodes.list() }))
    .post("/validate", async (c) => {
      try {
        const body = await c.req.json<Record<string, unknown>>();
        const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
        const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
        const type = validType(body.type) ? body.type : "openai-compatible";
        const modelId = typeof body.modelId === "string" ? body.modelId : "";
        if (!baseUrl || !apiKey) return c.json({ error: "Base URL and API key required" }, 400);
        try {
          new URL(baseUrl);
        } catch {
          return c.json({ error: "Invalid URL format" }, 400);
        }
        if (!isLocalRequest(c.req.raw)) {
          try {
            assertPublicUrl(baseUrl);
          } catch {
            return c.json({ error: "URL not allowed" }, 400);
          }
        }

        const normalizedBase = normalizeBaseUrl(type, baseUrl);
        if (type === "custom-embedding") {
          const embeddingModelId = modelId.trim();
          if (!embeddingModelId) return c.json({ valid: false, error: "Model ID required for embedding validation" });
          const response = await probe(`${normalizedBase}/embeddings`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: embeddingModelId, input: "ping" }),
          });
          if (response.ok) {
            const data = await response.json().catch(() => null) as { data?: Array<{ embedding?: unknown }> } | null;
            const embedding = data?.data?.[0]?.embedding;
            return c.json({ valid: true, method: "embeddings", dimensions: Array.isArray(embedding) ? embedding.length : null });
          }
          if (response.status === 401 || response.status === 403) return c.json({ valid: false, error: "API key unauthorized" });
          const detail = await response.text().catch(() => "");
          return c.json({ valid: false, error: `Embeddings request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`, method: "embeddings" });
        }

        const headers: Record<string, string> = type === "anthropic-compatible"
          ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01", Authorization: `Bearer ${apiKey}` }
          : { Authorization: `Bearer ${apiKey}` };
        const response = await probe(`${normalizedBase}/models`, { headers });
        if (response.ok) return c.json({ valid: true });
        if (response.status === 401 || response.status === 403) return c.json({ valid: false, error: "API key unauthorized" });
        if (!modelId) return c.json({ valid: false, error: modelsError(response.status) });

        const chatResponse = await probe(`${normalizedBase}/chat/completions`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
        });
        if (chatResponse.ok) return c.json({ valid: true, method: "chat" });
        return c.json({ valid: false, error: chatError(chatResponse.status), method: "chat" });
      } catch (error: any) {
        return c.json({ valid: false, error: networkError(error) }, 500);
      }
    })
    .post("/", async (c) => {
      const body = await c.req.json<Record<string, unknown>>();
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const prefix = typeof body.prefix === "string" ? body.prefix.trim() : "";
      const type = body.type || "openai-compatible";
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (id) {
        const invalid = nodeIdError(runtime, id);
        if (invalid) return c.json({ error: invalid.error }, invalid.status);
      }
      if (!name) return c.json({ error: "Name is required" }, 400);
      if (!prefix) return c.json({ error: "Prefix is required" }, 400);
      if (!validType(type)) return c.json({ error: "Invalid provider node type" }, 400);
      if (type === "openai-compatible" && !["chat", "responses"].includes(String(body.apiType))) return c.json({ error: "Invalid OpenAI compatible API type" }, 400);
      return c.json({ node: runtime.repos.nodes.create({ ...body, id: id || undefined, name, prefix, type, baseUrl: normalizeBaseUrl(type, body.baseUrl) }) }, 201);
    })
    .put("/:id", async (c) => {
      const id = c.req.param("id");
      const current = runtime.repos.nodes.get(id);
      if (!current) return c.json({ error: "Provider node not found" }, 404);
      const body = await c.req.json<Record<string, unknown>>();
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const prefix = typeof body.prefix === "string" ? body.prefix.trim() : "";
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
      if (!name) return c.json({ error: "Name is required" }, 400);
      if (!prefix) return c.json({ error: "Prefix is required" }, 400);
      if (!baseUrl) return c.json({ error: "Base URL is required" }, 400);
      if (current.type === "openai-compatible" && !["chat", "responses"].includes(String(body.apiType))) return c.json({ error: "Invalid OpenAI compatible API type" }, 400);
      const node = runtime.repos.nodes.update(id, { name, prefix, baseUrl: normalizeBaseUrl(current.type as NodeType, baseUrl), ...(current.type === "openai-compatible" ? { apiType: body.apiType } : {}) })!;
      for (const connection of runtime.repos.providers.list(true).filter((item) => item.provider === id)) {
        runtime.repos.providers.patch(connection.id, {
          data: { prefix: node.prefix, ...(node.type === "openai-compatible" ? { apiType: node.apiType } : {}), baseUrl: node.baseUrl, nodeName: node.name },
        });
      }
      return c.json({ node });
    })
    .delete("/:id", (c) => runtime.repos.nodes.remove(c.req.param("id")) ? c.json({ success: true }) : c.json({ error: "Provider node not found" }, 404));
}
