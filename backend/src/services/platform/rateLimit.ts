// In-memory sliding-window rate limiter keyed by API key id.
//
// Optional per-key thresholds (requestsPerMinute / requestsPerSecond) live in
// the key's `features` JSON. Enforcement is process-local: each timestamp is
// pruned on read, so memory stays bounded by the number of keys under load.
// A restart clears the windows, matching the lifetime-limit semantics already
// in place (usageRequests/usageTokens also reset on reset).

type Window = { timestamps: number[] };

const buckets = new Map<string, Window>();

function windowFor(keyId: string): Window {
  let entry = buckets.get(keyId);
  if (!entry) {
    entry = { timestamps: [] };
    buckets.set(keyId, entry);
  }
  return entry;
}

function prune(timestamps: number[], cutoff: number): number[] {
  while (timestamps.length && timestamps[0] <= cutoff) timestamps.shift();
  return timestamps;
}

export interface RateLimitResult {
  allowed: boolean;
  message: string | null;
}

// Reset a key's in-memory windows (no-op identity mapping when the key has no
// rate limit; callers may call it unconditionally on key update/deletion).
export function resetRateLimit(keyId: string): void {
  buckets.delete(keyId);
}

export function checkRateLimit(keyId: string, requestsPerMinute: number | null | undefined, requestsPerSecond: number | null | undefined): RateLimitResult {
  const now = Date.now();
  const rpm = Number(requestsPerMinute);
  const rps = Number(requestsPerSecond);
  const hasRpm = Number.isFinite(rpm) && rpm > 0;
  const hasRps = Number.isFinite(rps) && rps > 0;
  if (!hasRpm && !hasRps) return { allowed: true, message: null };

  const entry = windowFor(keyId);

  if (hasRpm) {
    const cutoff = now - 60_000;
    entry.timestamps = prune(entry.timestamps, cutoff);
    if (entry.timestamps.length >= rpm) {
      return { allowed: false, message: `Rate limit exceeded (${rpm} requests/minute)` };
    }
  }

  if (hasRps) {
    const cutoff = now - 1000;
    entry.timestamps = prune(entry.timestamps, cutoff);
    if (entry.timestamps.length >= rps) {
      return { allowed: false, message: `Rate limit exceeded (${rps} requests/second)` };
    }
  }

  entry.timestamps.push(now);
  return { allowed: true, message: null };
}