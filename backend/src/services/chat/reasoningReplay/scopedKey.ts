// reasoningReplay/scopedKey.js
// Ported from grok2api infra/provider/cli/adapter.go scopedReasoningReplayKey.
// Derives a per-connection, per-plane replay key so cached reasoning state never leaks
// across accounts or upstream planes (build vs xai fallback).

import { createHash } from "node:crypto";

const KEY_NAMESPACE = "grok2api:reasoning-replay:v2";

// scopedReplayKey: deterministic, opaque digest. Empty seed or missing connectionId
// returns "" (caller must skip replay in that case — no safe scope to cache under).
export function scopedReplayKey({ seed, connectionId, plane = "build" } = {} as any) {
  const safeSeed = typeof seed === "string" ? seed.trim() : "";
  const safeConn = connectionId == null ? "" : String(connectionId);
  if (safeSeed === "" || safeConn === "") return "";
  const material = `${KEY_NAMESPACE}:${safeSeed}:${safeConn}:${plane}`;
  return createHash("sha256").update(material).digest("hex");
}
