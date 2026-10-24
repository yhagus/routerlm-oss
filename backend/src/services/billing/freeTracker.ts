export const INFERHUB_URL = "https://inferhub.dev/pricing";

interface Pool {
  id: string;
  name: string;
  prefix: string;
  kind: "shared" | "open";
  usedPercent: number | null;
  remainingPercent: number | null;
  models: string[];
}

interface SourcePayload {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  pools: Pool[];
}

interface TrackerSource {
  id: string;
  name: string;
  icon: string;
  sourceUrl: string;
  note: string;
  models: Array<{
    id: string;
    poolId: string;
    poolName: string;
    poolPrefix: string;
    kind: "shared" | "open";
    usedPercent: number | null;
    remainingPercent: number | null;
  }>;
  publicVisible: boolean;
}

interface CachedPayloads {
  cachedAt: number;
  inferhub: { ok: true; payload: SourcePayload } | { ok: false; error: string };
}

let cache: CachedPayloads | null = null;
const CACHE_TTL_MS = 30_000;

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function cardEndFrom(html: string, fromIndex: number): number {
  const after = html.slice(fromIndex + 1);
  const nextH2 = after.search(/<h2\b/i);
  const autoRouted = after.search(/Auto-routed models/i);
  let relativeEnd = after.length;
  if (nextH2 >= 0) relativeEnd = Math.min(relativeEnd, nextH2);
  if (autoRouted >= 0) relativeEnd = Math.min(relativeEnd, autoRouted);
  return fromIndex + 1 + relativeEnd;
}

export function parseInferhubFreePools(html: string): Pool[] {
  const cleaned = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  const pools: Pool[] = [];
  const seen = new Set<string>();
  const headings = /<h2[^>]*>([^<]+)<\/h2>/gi;
  let heading: RegExpExecArray | null;
  while ((heading = headings.exec(cleaned)) !== null) {
    const name = decodeEntities(heading[1].trim());
    if (!name || /auto-routed/i.test(name)) continue;
    const cardStart = heading.index;
    const cardEnd = cardEndFrom(cleaned, heading.index + heading[0].length - 1);
    const card = cleaned.slice(cardStart, cardEnd);
    const prefixMatch = card.match(/\b(free\/[a-zA-Z0-9_-]+)\//);
    const prefix = prefixMatch?.[1];
    if (!prefix || !/\bfree$/i.test(name) && !prefix.startsWith("free/")) continue;
    const models = [...card.matchAll(/\b(free\/[a-zA-Z0-9_./-]+)\b/g)]
      .map((match) => match[1])
      .filter((model, index, values) => model.startsWith(`${prefix}/`) && model !== `${prefix}/` && values.indexOf(model) === index);
    const hasSharedLabel = /Shared\s+[Qq]uota/.test(card);
    const usedMatch = card.match(/(\d+)\s*%\s*used/i);
    if (!models.length && !hasSharedLabel || seen.has(prefix)) continue;
    seen.add(prefix);
    const used = usedMatch ? Math.min(100, Math.max(0, Number(usedMatch[1]))) : null;
    const kind = hasSharedLabel && used != null ? "shared" : "open";
    pools.push({
      id: prefix,
      name,
      prefix: `${prefix}/`,
      kind,
      usedPercent: kind === "shared" ? used : null,
      remainingPercent: kind === "shared" && used != null ? 100 - used : null,
      models,
    });
  }
  return pools.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "shared" ? -1 : 1;
    if (left.kind === "shared" && left.remainingPercent !== right.remainingPercent) return (left.remainingPercent ?? 0) - (right.remainingPercent ?? 0);
    return left.name.localeCompare(right.name);
  });
}

async function fetchInferhub(fetchImpl: typeof fetch): Promise<SourcePayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(INFERHUB_URL, { headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "LobakAI-FreeTracker/2.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`InferHub pricing returned HTTP ${response.status}`);
    return { source: "inferhub", sourceUrl: INFERHUB_URL, fetchedAt: new Date().toISOString(), pools: parseInferhubFreePools(await response.text()) };
  } finally {
    clearTimeout(timer);
  }
}

async function settled<T>(operation: Promise<T>, label: string): Promise<{ ok: true; payload: T } | { ok: false; error: string }> {
  try {
    return { ok: true, payload: await operation };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error && error.name === "AbortError" ? `Timed out fetching ${label}` : error instanceof Error ? error.message : `Failed to fetch ${label}` };
  }
}

async function fetchPayloads(fetchImpl: typeof fetch): Promise<CachedPayloads & { cached: boolean }> {
  const now = Date.now();
  if (cache && now - cache.cachedAt < CACHE_TTL_MS) return { ...cache, cached: true };
  const inferhub = await settled(fetchInferhub(fetchImpl), "InferHub");
  cache = { cachedAt: now, inferhub };
  return { ...cache, cached: false };
}

function flatten(pools: Pool[], meta: Pick<TrackerSource, "id" | "name" | "icon" | "sourceUrl" | "note">, publicVisible: boolean): TrackerSource {
  const models = pools.flatMap((pool) => {
    const ids = pool.models.length ? pool.models : [pool.prefix.replace(/\/$/, "")];
    return ids.map((id) => ({ id, poolId: pool.id, poolName: pool.name, poolPrefix: pool.prefix, kind: pool.kind, usedPercent: pool.kind === "shared" ? pool.usedPercent : null, remainingPercent: pool.kind === "shared" ? pool.remainingPercent : null }));
  }).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "shared" ? -1 : 1;
    if (left.kind === "shared" && left.remainingPercent !== right.remainingPercent) return (left.remainingPercent ?? 0) - (right.remainingPercent ?? 0);
    return left.id.localeCompare(right.id);
  });
  return { ...meta, models, publicVisible };
}

export function clearFreeTrackerCache(): void {
  cache = null;
}

export async function buildFreeTrackerSources(settings: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const result = await fetchPayloads(fetchImpl);
  const visibility = settings.freeTrackerPublic && typeof settings.freeTrackerPublic === "object" && !Array.isArray(settings.freeTrackerPublic)
    ? settings.freeTrackerPublic as Record<string, unknown>
    : {};
  const sources: TrackerSource[] = [];
  const errors: string[] = [];
  let fetchedAt: string | null = null;
  if (result.inferhub.ok) {
    fetchedAt = result.inferhub.payload.fetchedAt;
    sources.push(flatten(result.inferhub.payload.pools, { id: "inferhub", name: "InferHub", icon: "/providers/inferhub.png", sourceUrl: INFERHUB_URL, note: "Shared bars are community pools, not your local account quota." }, visibility.inferhub === true));
  } else errors.push(result.inferhub.error);
  if (!sources.length) throw new Error(errors[0] || "Failed to fetch free model quotas");
  const primary = result.inferhub.ok ? result.inferhub.payload : null;
  return {
    sources,
    fetchedAt: fetchedAt || new Date().toISOString(),
    cached: result.cached,
    pools: primary?.pools || [],
    source: "inferhub",
    sourceUrl: INFERHUB_URL,
    ...(errors.length ? { partialErrors: errors } : {}),
  };
}
