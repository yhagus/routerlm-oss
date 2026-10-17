/**
 * Wrap chat-completions endpoints (with built-in web search) into the unified
 * /v1/search response format. Supports openai.
 */
import { PROVIDER_MEDIA } from "../../providers/index.ts";

// Default search model + endpoint derive from registry searchViaChat (single source)
const searchModel = (id: any) => PROVIDER_MEDIA[id]?.searchViaChat?.defaultModel;
const searchEndpoint = (id: any, model?: any) =>
  (PROVIDER_MEDIA[id]?.searchViaChat?.endpoint || "").replace("{model}", model || "");

const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESULTS = 10;

/**
 * Normalize a citation entry into the unified result shape.
 * @param {{url:string, title?:string, snippet?:string}} c
 * @param {number} index
 * @param {string} provider
 * @param {string} retrievedAt
 */
function toResult(c: any, index: any, provider: any, retrievedAt: any) {
  return {
    title: c.title || "",
    url: c.url,
    snippet: c.snippet || "",
    position: index + 1,
    score: null,
    published_at: null,
    favicon_url: null,
    content: null,
    metadata: {} as Record<string, any>,
    citation: { provider, retrieved_at: retrievedAt, rank: index + 1 },
    provider_raw: null
  };
}

/** Coerce a citation that might be a raw URL string or an object. */
function normalizeCitation(c: any) {
  if (!c) return null;
  if (typeof c === "string") return { url: c };
  if (typeof c === "object" && c.url) return c;
  return null;
}

/**
 * Provider-specific configuration map. All providers must implement:
 * { endpoint, defaultModel, buildBody, buildHeaders, extractAnswer }
 */
const CHAT_SEARCH_CONFIG: Record<string, any> = {
  openai: {
    endpoint: () => searchEndpoint("openai"),
    buildBody: (query: any, model: any) => {
      const body: Record<string, any> = {
        model,
        messages: [{ role: "user", content: query }]
      };
      // Non-search-preview models need explicit web_search tool
      if (!/search/i.test(model)) {
        body.tools = [{ type: "web_search" }];
      }
      return body;
    },
    buildHeaders: (token: any) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data: any) => {
      const msg = data?.choices?.[0]?.message || {};
      const text = msg.content || "";
      const annotations = Array.isArray(msg.annotations) ? msg.annotations : [];
      const fromAnn = annotations
        .map((a: any) => a?.url_citation)
        .filter(Boolean)
        .map((u: any) => ({ url: u.url, title: u.title || "" }));
      const fromTop = Array.isArray(data?.citations)
        ? data.citations.map(normalizeCitation).filter(Boolean)
        : [];
      const citations = fromAnn.length ? fromAnn : fromTop;
      const tokens = data?.usage?.total_tokens || 0;
      return { text, citations, tokens };
    }
  }
};

/**
 * Execute a chat-search request against the chosen provider.
 * @param {object} params
 * @param {string} params.provider
 * @param {string} params.query
 * @param {number} [params.maxResults]
 * @param {string} [params.model]
 * @param {{apiKey?:string, accessToken?:string}} params.credentials
 * @param {{info?:Function, warn?:Function, error?:Function}} [params.log]
 * @returns {Promise<{success:boolean, status?:number, error?:string, data?:object}>}
 */
export async function handleChatSearch({
  provider,
  query,
  maxResults,
  model,
  credentials,
  log
}: any) {
  const startTime = Date.now();
  const cfg = CHAT_SEARCH_CONFIG[provider];

  if (!cfg) {
    return {
      success: false,
      status: 400,
      error: `Unsupported chat-search provider: ${provider}`
    };
  }

  if (!query || typeof query !== "string") {
    return { success: false, status: 400, error: "Missing query" };
  }

  const token = credentials?.apiKey || credentials?.accessToken;
  if (!token) {
    return {
      success: false,
      status: 401,
      error: "Missing credentials (apiKey or accessToken)"
    };
  }

  const limit =
    Number.isFinite(maxResults) && maxResults > 0
      ? Math.floor(maxResults)
      : DEFAULT_MAX_RESULTS;
  const useModel = model || searchModel(provider);
  const url = cfg.endpoint(useModel);
  const body = cfg.buildBody(query, useModel);
  const headers = cfg.buildHeaders(token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let upstreamStart = Date.now();
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === "AbortError") {
      log?.warn?.(`[chatSearch] timeout provider=${provider}`);
      return { success: false, status: 504, error: "Upstream timeout" };
    }
    log?.error?.(`[chatSearch] network error provider=${provider}: ${err?.message}`);
    return {
      success: false,
      status: 502,
      error: `Network error: ${err?.message || "unknown"}`
    };
  }
  clearTimeout(timer);
  const upstreamLatency = Date.now() - upstreamStart;

  let data;
  try {
    data = await resp.json();
  } catch {
    return {
      success: false,
      status: 502,
      error: `Invalid upstream response (status ${resp.status})`
    };
  }

  if (!resp.ok) {
    const errMsg =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `Upstream HTTP ${resp.status}`;
    log?.warn?.(`[chatSearch] upstream error provider=${provider} status=${resp.status}`);
    return {
      success: false,
      status: resp.status,
      error: typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg)
    };
  }

  const { text, citations, tokens } = cfg.extractAnswer(data);
  const retrievedAt = new Date().toISOString();
  const limited = (citations || []).slice(0, limit);
  const results = limited.map((c: any, i: any) => toResult(c, i, provider, retrievedAt));

  return {
    success: true,
    status: 200,
    data: {
      provider,
      query,
      results,
      answer: { source: provider, text: text || "", model: useModel },
      usage: { queries_used: 1, search_cost_usd: 0, llm_tokens: tokens || 0 },
      metrics: {
        response_time_ms: Date.now() - startTime,
        upstream_latency_ms: upstreamLatency,
        total_results_available: null
      },
      errors: [] as any[]}
  };
}

export { CHAT_SEARCH_CONFIG };
