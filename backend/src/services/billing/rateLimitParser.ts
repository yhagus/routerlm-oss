/**
 * Rate limit metadata parser for Grok CLI / Grok Build 429 responses.
 * 
 * Mirrors grok2api's rate_limit.go:
 * - Parses "Requests per Second/Minute (actual/limit): N/M" from error bodies
 * - Extracts team ID and model from error text
 * - Parses "Resets in: 1h 2m 3s" reset windows
 * - Forwards Retry-After header to client
 * - Injects Retry-After when body has reset info but header is missing
 */

export interface RateLimitMetadata {
  scope: "rps" | "rpm";
  teamId: string | null;
  model: string | null;
  actual: number;
  limit: number;
  retryAfter: number;
}

const RATE_LIMIT_USAGE_PATTERN = /Requests?\s+per\s+(Second|Minute)\s*\(\s*actual\s*\/\s*limit\s*\)\s*:\s*(\d+)\s*\/\s*(\d+)/i;
const RATE_LIMIT_TEAM_PATTERN = /team\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const RATE_LIMIT_MODEL_PATTERN = /model\s+["']?([A-Za-z0-9][A-Za-z0-9._:/-]*)/i;
const RATE_LIMIT_RESET_PATTERN = /(\d+)\s*([dhms])/gi;

export function parseRateLimitMetadata(bodyText: string): RateLimitMetadata | null {
  const texts = collectRateLimitTexts(bodyText);
  for (const text of texts) {
    const metadata = parseRateLimitText(text);
    if (metadata) return metadata;
  }
  return null;
}

function collectRateLimitTexts(bodyText: string): string[] {
  const texts: string[] = [bodyText];
  try {
    const parsed = JSON.parse(bodyText);
    collectFromValue(parsed, texts);
  } catch {
  }
  return texts;
}

function collectFromValue(value: any, texts: string[]): void {
  if (!value) return;
  if (typeof value === "object") {
    if (typeof value.message === "string") texts.push(value.message);
    if (typeof value.error === "string") texts.push(value.error);
    for (const key of Object.keys(value)) {
      collectFromValue(value[key], texts);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectFromValue(item, texts);
    }
  } else if (typeof value === "string") {
    texts.push(value);
  }
}

function parseRateLimitText(text: string): RateLimitMetadata | null {
  const match = RATE_LIMIT_USAGE_PATTERN.exec(text);
  if (!match) return null;
  const scope = match[1].toLowerCase() === "second" ? "rps" : "rpm";
  const actual = parseInt(match[2], 10) || 0;
  const limit = parseInt(match[3], 10) || 0;
  let retryAfter = scope === "rps" ? 2 : 60;
  const resetAfter = parseResetAfter(text);
  if (resetAfter > 0) {
    retryAfter = resetAfter;
    if (scope === "rps" && retryAfter < 2) retryAfter = 2;
  }
  return {
    scope,
    teamId: parseTeamId(text),
    model: parseModel(text),
    actual,
    limit,
    retryAfter,
  };
}

function parseTeamId(text: string): string | null {
  const match = RATE_LIMIT_TEAM_PATTERN.exec(text);
  return match ? match[1] : null;
}

function parseModel(text: string): string | null {
  const match = RATE_LIMIT_MODEL_PATTERN.exec(text);
  if (!match) return null;
  return match[1].replace(/[.,;]+$/, "");
}

function parseResetAfter(text: string): number {
  const index = text.toLowerCase().indexOf("resets in:");
  if (index < 0) return 0;
  const afterText = text.slice(index + "resets in:".length);
  let total = 0;
  let match;
  RATE_LIMIT_RESET_PATTERN.lastIndex = 0;
  while ((match = RATE_LIMIT_RESET_PATTERN.exec(afterText)) !== null) {
    const value = parseInt(match[1], 10) || 0;
    switch (match[2].toLowerCase()) {
      case "d": total += value * 86400; break;
      case "h": total += value * 3600; break;
      case "m": total += value * 60; break;
      case "s": total += value; break;
    }
  }
  return total;
}

export function parseRetryAfterHeader(headerValue: string | null): number {
  if (!headerValue) return 0;
  const trimmed = headerValue.trim();
  const seconds = parseInt(trimmed, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) {
    const diff = Math.ceil((date - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
  }
  return 0;
}

export function enrichRateLimitHeaders(headers: Headers, bodyText: string): void {
  const existingRetryAfter = headers.get("retry-after");
  if (existingRetryAfter) return;
  const metadata = parseRateLimitMetadata(bodyText);
  if (metadata && metadata.retryAfter > 0) {
    headers.set("retry-after", String(metadata.retryAfter));
  }
}

export function buildRateLimitResponseHeaders(metadata: RateLimitMetadata | null, existingHeaders: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const retryAfter = existingHeaders.get("retry-after");
  if (retryAfter) {
    result["retry-after"] = retryAfter;
  } else if (metadata && metadata.retryAfter > 0) {
    result["retry-after"] = String(metadata.retryAfter);
  }
  for (const [key, value] of existingHeaders.entries()) {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-ratelimit-") || lower.startsWith("ratelimit-")) {
      result[key] = value;
    }
  }
  return result;
}
