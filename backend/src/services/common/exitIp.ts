// Resolve the actual egress IP that upstream providers see for a given
// proxyOptions set. Probes https://ipv4.webshare.io/ through the exact same
// proxyAwareFetch path the upstream request will take (connection proxy,
// env proxy, vercel relay, or direct). Results are cached briefly per proxy
// route so streaming requests do not pay an extra round-trip each time.

import { proxyAwareFetch } from "./proxyFetch.ts";

const PROBE_URL = "https://ipv4.webshare.io/";
const TTL_MS = 60_000;

// Bare IPv4 (203.0.113.42) or IPv6 (2001:db8::1, possibly bracketed). Rejects
// HTML error pages, "not found", and other non-IP probe bodies so a mocked or
// failed probe never prints garbage into the request line.
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_RE = /^\[?[0-9a-fA-F:]+\]?$/;

function parseIp(body: string): string | null {
  const text = body.trim();
  if (!text || text.length > 45) return null;
  if (IPV4_RE.test(text)) return text;
  if (text.includes(":") && IPV6_RE.test(text)) return text;
  return null;
}

type CacheEntry = { ip: string | null; at: number };
const cache = new Map<string, CacheEntry>();

function routeKey(proxyOptions: Record<string, any> | null): { key: string; probeOptions: Record<string, any> | null } {
  const relay = String(proxyOptions?.vercelRelayUrl ?? "").trim();
  if (relay) return { key: `relay:${relay}`, probeOptions: { vercelRelayUrl: relay } };
  const enabled = proxyOptions?.connectionProxyEnabled === true;
  const url = String(proxyOptions?.connectionProxyUrl ?? "").trim();
  if (enabled && url) {
    return {
      key: `proxy:${url}`,
      probeOptions: {
        connectionProxyEnabled: true,
        connectionProxyUrl: url,
        connectionNoProxy: String(proxyOptions?.connectionNoProxy ?? ""),
        strictProxy: proxyOptions?.strictProxy === true,
      },
    };
  }
  return { key: "direct", probeOptions: null };
}

/**
 * Resolve the upstream-facing exit IP for these proxyOptions.
 * Returns null when the probe fails or times out — never throws, never
 * blocks the request path for more than `timeoutMs`.
 */
export async function resolveExitIp(
  proxyOptions: Record<string, any> | null,
  { timeoutMs = 5_000 }: { timeoutMs?: number } = {},
): Promise<string | null> {
  const { key, probeOptions } = routeKey(proxyOptions);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ip;
  try {
    // `Connection: close` forces a fresh tunnel so rotating proxies rotate.
    const res = await proxyAwareFetch(
      PROBE_URL,
      { signal: AbortSignal.timeout(timeoutMs), headers: { Connection: "close" } },
      probeOptions,
    );
    const ip = parseIp(await res.text());
    cache.set(key, { ip, at: Date.now() });
    return ip;
  } catch {
    cache.set(key, { ip: null, at: Date.now() });
    return null;
  }
}
