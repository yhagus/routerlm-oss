import { HTTP_STATUS, RETRY_CONFIG, DEFAULT_RETRY_CONFIG, resolveRetryEntry, FETCH_CONNECT_TIMEOUT_MS } from "../../providers/config/runtimeConfig.ts";
import { shouldRefreshCredentials } from "../../providers/oauth/oauthCredentialManager.ts";
import { proxyAwareFetch } from "../../common/proxyFetch.ts";
import { dbg } from "../utils/debugLog.js";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../../providers/registryShared.ts";
import { customNodeType, openAICompatibleApiType } from "../../providers/customNodes.ts";

/**
 * BaseExecutor - Base class for provider executors
 */
export class BaseExecutor {
  provider: any;
  config: any;
  noAuth: any;
  constructor(provider: any, config: any) {
    this.provider = provider;
    this.config = config;
    this.noAuth = config?.noAuth || false;
  }

  getProvider() {
    return this.provider;
  }

  getBaseUrls() {
    return this.config.baseUrls || (this.config.baseUrl ? [this.config.baseUrl] : []);
  }

  getFallbackCount() {
    return this.getBaseUrls().length || 1;
  }

  buildUrl(model: any, stream: any, urlIndex = 0, credentials: any = null) {
    if (customNodeType(this.provider) === "openai-compatible") {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || OPENAI_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      const path = openAICompatibleApiType(this.provider) === "responses" ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (customNodeType(this.provider) === "anthropic-compatible") {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || ANTHROPIC_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    const baseUrls = this.getBaseUrls();
    return baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
  }

  buildHeaders(credentials: any, stream = true, url?: any) {
    const headers: Record<string, any> = {
      "Content-Type": "application/json",
      ...this.config.headers
    };

    if (customNodeType(this.provider) === "anthropic-compatible") {
      // Anthropic-compatible providers use x-api-key header
      if (credentials.apiKey) {
        headers["x-api-key"] = credentials.apiKey;
      } else if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      if (!headers["anthropic-version"]) {
        headers["anthropic-version"] = ANTHROPIC_API_VERSION;
      }
    } else {
      // Standard Bearer token auth for other providers
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      } else if (credentials.apiKey) {
        headers["Authorization"] = `Bearer ${credentials.apiKey}`;
      }
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  // Override in subclass for provider-specific transformations
  transformRequest(model: any, body: any, stream: any, credentials: any) {
    return body;
  }

  shouldRetry(status: any, urlIndex: any) {
    return status === HTTP_STATUS.RATE_LIMITED && urlIndex + 1 < this.getFallbackCount();
  }

  // Override in subclass for provider-specific refresh
  async refreshCredentials(credentials: any, log: any, proxyOptions: any = null): Promise<any> {
    return null;
  }

  computeRetryDelay?: any;
  recoverUpstreamError?: any;

  needsRefresh(credentials: any) {
    return shouldRefreshCredentials(this.provider, credentials);
  }

  parseError(response: any, bodyText: any) {
    return { status: response.status, message: bodyText || `HTTP ${response.status}` };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }: any): Promise<any> {
    const fallbackCount = this.getFallbackCount();
    let lastError = null;
    let lastStatus = 0;
    const retryAttemptsByUrl: Record<string, any> = {};
    // Merge default retry config with provider-specific config
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };

    // Schedule retry via retryConfig[statusKey]. Returns true when caller should `urlIndex--; continue`
    // response (optional) lets a subclass hook compute a dynamic delay (e.g. antigravity Retry-After).
    const tryRetry = async (urlIndex: any, statusKey: any, reason: any, response: any = null) => {
      const { attempts, delayMs } = resolveRetryEntry(retryConfig[statusKey]);
      if (attempts <= 0 || retryAttemptsByUrl[urlIndex] >= attempts) return false;
      // Hook: subclass may derive delay from the response (headers/body). null → skip retry, use fallback.
      let waitMs = delayMs;
      if (response && this.computeRetryDelay) {
        const dynamic = await this.computeRetryDelay(response, retryAttemptsByUrl[urlIndex] + 1, delayMs);
        if (dynamic === false) return false; // hook vetoes retry (e.g. Retry-After too long)
        if (dynamic != null) waitMs = dynamic;
      }
      retryAttemptsByUrl[urlIndex]++;
      log?.debug?.("RETRY", `${reason} retry ${retryAttemptsByUrl[urlIndex]}/${attempts} after ${waitMs / 1000}s`);
      await new Promise<any>(resolve => setTimeout(resolve, waitMs));
      return true;
    };

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex, credentials);
      // await supports both sync transformRequest (no-op) and async ones (e.g. grok-cli
      // reasoning-replay Apply, which reads the async KV cache before dispatching upstream).
      const transformedBody = await this.transformRequest(model, body, stream, credentials);
      const headers = this.buildHeaders(credentials, stream, url);

      if (!retryAttemptsByUrl[urlIndex]) retryAttemptsByUrl[urlIndex] = 0;

      // Abort if upstream doesn't return response headers within connection timeout
      const connectCtrl = new AbortController();
      const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
      const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

       try {
         const bodyStr = JSON.stringify(transformedBody);
         const fetchT0 = Date.now();
         dbg("FETCH", `${this.provider.toUpperCase()} → ${url} | body=${bodyStr.length}B | connectTimeout=${timeoutMs}ms`);
        const response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: mergedSignal
        }, proxyOptions);
        clearTimeout(connectTimer);
        const ct = response.headers?.get?.("content-type") || "";
        const cl = response.headers?.get?.("content-length") || "?";
        dbg("FETCH", `${this.provider.toUpperCase()} ← ${response.status} | ttft=${Date.now() - fetchT0}ms | ct=${ct} | cl=${cl}`);

        // Reasoning-replay recovery hook (grok-cli): if upstream 400s on an opaque-
        // reasoning decode failure, the executor may strip encrypted_content / reset the
        // session and retry once before surfacing the error. No-op for providers that
        // don't override recoverUpstreamError. The retry bypasses transformRequest (raw
        // re-fetch with the prepared+stripped body) so it won't re-Apply the dead blob.
        if (response.status === 400 && typeof this.recoverUpstreamError === "function") {
          let recovered = null;
          try {
            recovered = await this.recoverUpstreamError({
              response, url, headers, body: transformedBody,
              credentials, signal: mergedSignal, proxyOptions, log,
              retry: async ({ body: retryBody }: any) => {
                const retryStr = JSON.stringify(retryBody);
                const r = await proxyAwareFetch(url, { method: "POST", headers, body: retryStr, signal: mergedSignal }, proxyOptions);
                // For 400, read the small error body so recovery can inspect decode-failure
                // markers. For non-400, leave the body intact (it's the SSE stream the
                // downstream handler needs to pipe to the client).
                if (r.status === 400) {
                  let txt = "";
                  try { txt = await r.text(); } catch { /* fall open */ }
                  return { response: r, url, status: r.status, body: txt, raw: r };
                }
                return { response: r, url, status: r.status, body: null, raw: r };
              },
            });
          } catch (e: any) {
            dbg("FETCH", `${this.provider.toUpperCase()} recovery error: ${e?.message || e}`);
          }
          if (recovered && recovered.response && recovered.response !== response) {
            return { response: recovered.response, url: recovered.url || url, headers, transformedBody };
          }
        }

        if (await tryRetry(urlIndex, response.status, `status ${response.status}`, response)) { urlIndex--; continue; }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          continue;
        }

        return { response, url, headers, transformedBody };
      } catch (error: any) {
        clearTimeout(connectTimer);
        lastError = error;
        const isConnectTimeout = connectCtrl.signal.aborted && error.name === "AbortError";
        dbg("FETCH", `${this.provider.toUpperCase()} ✖ ${error.name}: ${error.message}${isConnectTimeout ? " (connect timeout)" : ""}`);
        // Connect timeout is internal — convert to retryable network error, don't propagate AbortError
        if (error.name === "AbortError" && !isConnectTimeout) throw error;

        // Map network/fetch exceptions to 502 retry config
        if (await tryRetry(urlIndex, HTTP_STATUS.BAD_GATEWAY, `network "${error.message}"`)) { urlIndex--; continue; }

        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.("RETRY", `Error on ${url}, trying fallback ${urlIndex + 1}`);
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`);
  }
}

export default BaseExecutor;
