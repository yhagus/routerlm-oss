// OpenCode canonical session identity.
//
// The OpenCode free-tier gate (since 2026-09-16 / tightened 2026-10-14)
// validates the session id format sent in x-opencode-session /
// x-opencode-session-id. Only the official client's Identifier.descending()
// layout passes: "ses_" + 12 lowercase hex chars (a 48-bit inverted
// millisecond timestamp with counter 1, so the low 12 hex digits read ffe)
// + 14 Base62 characters. Any other shape is rejected with 403
// FreeTierError.
//
// Ported from opencode2api/internal/identity/request.go (CanonicalSessionID).

import { createHash } from "node:crypto";

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const CANONICAL_SESSION_PATTERN = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const DESCENDING_TIME_PART_PATTERN = /^[0-9a-f]{9}f[c-f][0-9a-f]$/;

/**
 * Renders 6 hash bytes as the official client's Identifier.descending()
 * layout: a 36-bit timestamp shifted into the top of a 48-bit word, ORed
 * with counter 1, then bitwise-NOT-ed so the low 12 hex digits read ffe.
 */
function descendingTimePart(hash: Buffer): string {
  const current =
    (BigInt(hash[0]) << 28n |
      BigInt(hash[1]) << 20n |
      BigInt(hash[2]) << 12n |
      BigInt(hash[3]) << 4n |
      BigInt(hash[4]) >> 4n) << 12n;
  const withCounter = current | 1n;
  const inverted = ~withCounter & 0xffffffffffffn;
  const bytes: number[] = [];
  for (let i = 5; i >= 0; i--) {
    bytes.push(Number((inverted >> BigInt(i * 8)) & 0xffn));
  }
  return Buffer.from(bytes).toString("hex");
}

function base62Fixed(n: bigint, width: number): string {
  const base = 62n;
  const out: string[] = new Array(width);
  for (let i = width - 1; i >= 0; i--) {
    const mod = n % base;
    n = n / base;
    out[i] = BASE62_ALPHABET[Number(mod)];
  }
  return out.join("");
}

/**
 * Returns signal unchanged when it already carries an official OpenCode
 * session minted by the client's Identifier.descending(). Any other
 * identity is deterministically re-encoded into that exact layout so the
 * free-tier gate's encoding check passes.
 */
export function canonicalSessionID(signal: string): string {
  if (CANONICAL_SESSION_PATTERN.test(signal)) {
    const timePart = signal.substring(4, 16);
    if (DESCENDING_TIME_PART_PATTERN.test(timePart)) {
      return signal;
    }
  }
  const hash = createHash("sha256").update("ses\0" + signal).digest();
  const timePart = descendingTimePart(hash.subarray(0, 6));
  const randomBytes = hash.subarray(6, 16);
  let n = 0n;
  for (const b of randomBytes) {
    n = (n << 8n) | BigInt(b);
  }
  const randomPart = base62Fixed(n, 14);
  return "ses_" + timePart + randomPart;
}
