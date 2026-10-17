import { Readable } from "stream";
import { MEMORY_CONFIG } from "../providers/config/runtimeConfig.ts";
import { dbg } from "../chat/utils/debugLog.js";

const originalFetch = globalThis.fetch;
const proxyDispatchers = new Map();

// Bun's fetch ignores undici dispatchers but has a native `proxy` init option
// (HTTP/SOCKS). Node keeps the undici ProxyAgent path unchanged.
const IS_BUN = typeof globalThis.Bun !== "undefined";

async function fetchViaProxy(url: any, options: any, proxyUrl: any) {
  if (IS_BUN) {
    return originalFetch(url, { ...options, proxy: proxyUrl });
  }
  const dispatcher = await getDispatcher(proxyUrl);
  return originalFetch(url, { ...options, dispatcher });
}

// ─── TLS fingerprinting via got-scraping (browser-like JA3) ───────────────
// Cloudflare-fronted hosts (e.g. cloud.zed.dev) may reject requests whose
// TLS fingerprint (JA3/JA4) doesn't match a known client.  Node.js undici
// has a distinctive fingerprint that differs from the real Zed app's
// reqwest/rustls stack.  got-scraping emits a browser-like JA3 that
// Cloudflare's bot management treats more permissively.
//
// Install got-scraping (npm i got-scraping) to enable; without it, requests
// fall back to native fetch transparently.
const TLS_SPOOF_HOSTS = new Set(["cloud.zed.dev"]);

function shouldSpoofTls(targetUrl: any) {
  try {
    const hostname = new URL(targetUrl).hostname;
    return TLS_SPOOF_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

let _gotScraping: any = null;
let _gotScrapingChecked = false;
const _gotScrapingLoggedHosts = new Set();

async function getGotScraping() {
  if (_gotScrapingChecked) return _gotScraping;
  _gotScrapingChecked = true;
  try {
    const mod = await import("got-scraping");
    _gotScraping = typeof mod.gotScraping === "function" ? mod.gotScraping : null;
    if (_gotScraping) dbg("TLS", "got-scraping loaded (browser-like JA3 enabled)");
  } catch (e: any) {
    dbg("TLS", `got-scraping unavailable, falling back to native fetch: ${e.message}`);
    _gotScraping = null;
  }
  return _gotScraping;
}

async function gotScrapingFetch(url: any, options: any, proxyUrl: any) {
  const gs = await getGotScraping();
  if (!gs) return null;

  const method = (options.method || "GET").toUpperCase();
  const headersInit = options.headers || {};
  const headers = headersInit instanceof Headers
    ? Object.fromEntries(headersInit.entries())
    : { ...headersInit };

  const requestOptions: any = {
    url,
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : options.body,
    throwHttpErrors: false,
    retry: { limit: 0 },
    timeout: { request: undefined },
    followRedirect: true,
    decompress: true,
  };
  if (proxyUrl) {
    const { ProxyAgent } = await import("undici");
    (requestOptions as any).https = { rejectUnauthorized: true };
    (requestOptions as any).agent = { http: new ProxyAgent(proxyUrl), https: new ProxyAgent(proxyUrl) };
  }

  return new Promise<any>((resolve, reject) => {
    let settled = false;
    const stream = gs.stream(requestOptions);

    if (options.signal) {
      const onAbort = () => { try { stream.destroy(new Error("aborted")); } catch { } };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    stream.once("response", (res: any) => {
      if (settled) return;
      settled = true;
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers || {})) {
        if (Array.isArray(v)) v.forEach((x) => resHeaders.append(k, String(x)));
        else if (v != null) resHeaders.set(k, String(v));
      }
      const body = Readable.toWeb(stream);
      resolve(new Response(body as any, { status: (res as any).statusCode, statusText: res.statusMessage || "", headers: resHeaders }));
    });

    stream.once("error", (err: any) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function tryGotScrapingFetch(url: any, options: any, proxyUrl: any) {
  try {
    const res = await gotScrapingFetch(url, options, proxyUrl);
    if (res) {
      try {
        const host = new URL(typeof url === "string" ? url : url.toString()).hostname;
        if (!_gotScrapingLoggedHosts.has(host)) {
          _gotScrapingLoggedHosts.add(host);
          dbg("TLS", `using got-scraping for ${host}`);
        }
      } catch { }
    }
    return res;
  } catch (e: any) {
    dbg("TLS", `got-scraping request failed, fallback to native fetch: ${e.message}`);
    return null;
  }
}

// DNS cache — use Map to avoid prototype pollution via malformed hostnames
const DNS_CACHE = new Map();
const MITM_BYPASS_HOSTS = [
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
  "q.us-east-1.amazonaws.com",
  "codewhisperer.us-east-1.amazonaws.com",
  "api2.cursor.sh",
];
const GOOGLE_DNS_SERVERS = ["8.8.8.8", "8.8.4.4"];
const HTTPS_PORT = 443;
const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 300;
const QODER_HOST_SUFFIXES = ["qoder.sh", "qoder.com"];

function normalizeString(value: any) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Resolve real IP using Google DNS (bypass system DNS)
 */
async function resolveRealIP(hostname: any) {
  const cached = DNS_CACHE.get(hostname);
  if (cached && Date.now() < cached.expiry) return cached.ip;

  try {
    const dns = await import("dns");
    const { promisify } = await import("util");
    const resolver = new dns.Resolver();
    resolver.setServers(GOOGLE_DNS_SERVERS);
    const resolve4 = promisify(resolver.resolve4.bind(resolver));
    const addresses = await resolve4(hostname);
    DNS_CACHE.set(hostname, { ip: addresses[0], expiry: Date.now() + MEMORY_CONFIG.dnsCacheTtlMs });
    return addresses[0];
  } catch (error: any) {
    console.warn(`[ProxyFetch] DNS resolve failed for ${hostname}:`, error.message);
    return null;
  }
}

/**
 * Check if request should bypass MITM DNS redirect
 */
function shouldBypassMitmDns(url: any) {
  try {
    const hostname = new URL(url).hostname;
    return MITM_BYPASS_HOSTS.some(host => hostname.includes(host));
  } catch { return false; }
}

function shouldBypassByNoProxy(targetUrl: any, noProxyValue: any) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try { hostname = new URL(targetUrl).hostname.toLowerCase(); } catch { return false; }
  const patterns = noProxy.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Get proxy URL from environment
 */
function getEnvProxyUrl(targetUrl: any) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  if (isQoderTarget(targetUrl)) {
    const qoderProxy = process.env.QODER_PROXY || process.env.qoder_proxy;
    if (qoderProxy) return qoderProxy;
  }

  let protocol;
  try { protocol = new URL(targetUrl).protocol; } catch { return null; }

  if (protocol === "https:") {
    return process.env.HTTPS_PROXY || process.env.https_proxy ||
      process.env.ALL_PROXY || process.env.all_proxy;
  }

  return process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy;
}

/**
 * Normalize proxy URL (allow host:port)
 */
function normalizeProxyUrl(proxyUrl: any) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {

    new URL(normalizedInput);
    return normalizedInput;
  } catch {
    // Allow "127.0.0.1:7890" style values
    return `http://${normalizedInput}`;
  }
}

function isQoderTarget(targetUrl: any) {
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    return QODER_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

function isSocksProxyUrl(proxyUrl: any) {
  try {
    const protocol = new URL(proxyUrl).protocol;
    return protocol === "socks:" || protocol === "socks5:" || protocol === "socks5h:";
  } catch {
    return false;
  }
}

function resolveConnectionProxyUrl(targetUrl: any, proxyOptions: any) {
  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

/**
 * Create proxy dispatcher lazily (undici-compatible)
 */
async function getDispatcher(proxyUrl: any) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;

  if (!proxyDispatchers.has(normalized)) {
    // Evict oldest entry if max size reached
    if (proxyDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      proxyDispatchers.delete(proxyDispatchers.keys().next().value);
    }
    const { ProxyAgent, Socks5ProxyAgent } = await import("undici");
    const parsed = new URL(normalized);
    if (parsed.protocol === "socks5h:") parsed.protocol = "socks5:";
    const dispatcher = isSocksProxyUrl(normalized)
      ? new Socks5ProxyAgent(parsed)
      : new ProxyAgent({ uri: normalized });
    proxyDispatchers.set(normalized, dispatcher);
  }

  return proxyDispatchers.get(normalized);
}

/**
 * Create HTTPS request with manual socket connection (bypass DNS)
 */
async function createBypassRequest(parsedUrl: any, realIP: any, options: any) {
  const httpsModule = await import("https");
  const netModule = await import("net");
  // CJS modules expose exports via .default in ESM dynamic import context
  const https = httpsModule.default ?? httpsModule;
  const net = netModule.default ?? netModule;

  return new Promise<any>((resolve, reject) => {
    const socket = new net.Socket();

    socket.connect(HTTPS_PORT, realIP, () => {
      const reqOptions = {
        socket,
        // SNI + cert hostname are validated against the hostname the caller
        // asked for, not the IP we connected to. This keeps the DNS-bypass
        // (avoiding /etc/hosts MITM) while still rejecting on-path attackers
        // that present a different cert. The MITM_BYPASS_HOSTS targets are
        // all public-CA-issued (Google / GitHub / AWS / Cursor) so default
        // verification works without any extra trust store.
        servername: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || "POST",
        headers: {
          ...options.headers,
          Host: parsedUrl.hostname,
        },
      };

      const req = https.request(reqOptions, (res) => {
        const response = {
          ok: (res as any).statusCode >= HTTP_SUCCESS_MIN && (res as any).statusCode < HTTP_SUCCESS_MAX,
          status: (res as any).statusCode,
          statusText: res.statusMessage,
          headers: new Map(Object.entries(res.headers as Record<string, any>)),
          body: Readable.toWeb(res),
          text: async () => {
            const chunks: any[] = [];
            for await (const chunk of res) chunks.push(chunk);
            return Buffer.concat(chunks).toString();
          },
          json: async () => JSON.parse(await response.text()),
        };
        resolve(response);
      });

      req.on("error", reject);
      if (options.body) {
        req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });

    socket.on("error", reject);
  });
}

export async function proxyAwareFetch(url: any, options: any = {}, proxyOptions: any = null): Promise<any> {
  const targetUrl = typeof url === "string" ? url : url.toString();

  // Vercel relay: forward request via relay headers
  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (vercelRelayUrl) {
    const parsed = new URL(targetUrl);
    const relayHeaders = {
      ...options.headers,
      "x-relay-target": `${parsed.protocol}//${parsed.host}`,
      "x-relay-path": `${parsed.pathname}${parsed.search}`,
    };
    return originalFetch(vercelRelayUrl, { ...options, headers: relayHeaders });
  }

  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;
  const strictProxy =
    proxyOptions?.strictProxy === true ||
    (isQoderTarget(targetUrl) && process.env.QODER_STRICT_PROXY === "1");

  // TLS fingerprint spoofing: for Cloudflare-fronted hosts that may reject
  // Node.js undici's JA3/JA4, try got-scraping (browser-like TLS) first.
  // Falls back to native fetch if got-scraping is unavailable or fails.
  if (shouldSpoofTls(targetUrl)) {
    const spoofed = await tryGotScrapingFetch(targetUrl, options, proxyUrl || undefined);
    if (spoofed) return spoofed;
  }

  // MITM DNS bypass: for known MITM-intercepted hosts, resolve real IP to avoid DNS spoof
  if (shouldBypassMitmDns(targetUrl)) {
    if (proxyUrl) {
      // Proxy resolves DNS externally (not affected by /etc/hosts) — use proxy directly
      try {
        return await fetchViaProxy(url, options, proxyUrl);
      } catch (proxyError: any) {
        if (strictProxy) {
          throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
        }
        console.warn(`[ProxyFetch] Proxy failed, falling back to direct bypass: ${proxyError.message}`);
      }
    }
    // No proxy — manually resolve real IP to bypass DNS spoof
    try {
      const parsedUrl = new URL(targetUrl);
      const realIP = await resolveRealIP(parsedUrl.hostname);
      if (realIP) return await createBypassRequest(parsedUrl, realIP, options);
    } catch (error: any) {
      // A cert-altname failure here means the direct-bypass got a cert that
      // doesn't match the hostname (e.g. a local proxy presenting a localhost
      // cert). The request falls through to native fetch anyway, so this is
      // not actionable — demote it to avoid spamming discovery/quota probes.
      if (!/ALTNAME_INVALID|SELF_SIGNED|CERT_/.test(error.message)) {
        console.warn(`[ProxyFetch] MITM bypass failed: ${error.message}`);
      }
    }
  }

  if (proxyUrl) {
    try {
      return await fetchViaProxy(url, options, proxyUrl);
    } catch (proxyError: any) {
      // If strictProxy is enabled, fail hard instead of falling back to direct
      if (strictProxy) {
        throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
      }
      console.warn(`[ProxyFetch] Proxy failed, falling back to direct: ${proxyError.message}`);
      return originalFetch(url, options);
    }
  }

  // TLS fingerprint spoofing already attempted above (before MITM/proxy blocks);
  // if we reach here, got-scraping was unavailable or failed and no proxy path
  // was taken. Fall through to native fetch.
  return originalFetch(url, options);
}

/**
 * Patched global fetch with env-proxy support and MITM DNS bypass
 */
async function patchedFetch(url: any, options: any = {}) {
  return proxyAwareFetch(url, options, null);
}

// Idempotency guard — only patch once to avoid wrapping multiple times
if ((globalThis as any).fetch !== patchedFetch) {
  (globalThis as any).fetch = patchedFetch as any;
}

export default patchedFetch;
