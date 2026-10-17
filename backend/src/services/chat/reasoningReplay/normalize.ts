// reasoningReplay/normalize.js
// Ported from grok2api backend/internal/pkg/reasoningreplay/normalize.go
// Validates + normalizes captured Responses output items for replay storage.
// Quality guard: entropy-validates encrypted_content (rejects Fernet/low-entropy blobs).

export const REPLAY_CONSTANTS = {
  MIN_ENCRYPTED_DECODED_LEN: 50,
  MIN_ENCRYPTED_ENTROPY: 0.85,
  MAX_ENCRYPTED_LEN: 8 << 20, // 8 MiB
};

// Reasoning/assistant/function_call/custom_tool_call are the only item types we cache.
const REPLAY_ITEM_TYPES = new Set([
  "reasoning",
  "message",
  "function_call",
  "custom_tool_call",
]);

// previousResponseIDPresent: skip replay when the client already references a stored
// response — the upstream server holds the prior state, so re-injecting would duplicate.
export function previousResponseIDPresent(body: any) {
  if (!body || typeof body !== "object") return false;
  const pri = body.previous_response_id;
  return typeof pri === "string" && pri.trim() !== "";
}

// extractReplayItemsFromPayload: pull output items of replayable types from a completed
// Responses JSON payload (string or already-parsed object). Returns { items, complete }.
// Accepts both top-level { output: [...] } and nested { response: { output: [...] } }.
export function extractReplayItemsFromPayload(payload: any) {
  let root = payload;
  if (typeof payload === "string") {
    try {
      root = JSON.parse(payload);
    } catch {
      return { items: [] as any[], complete: false };
    }
  }
  if (!root || typeof root !== "object") return { items: [] as any[], complete: false };

  let outputRaw = root.output;
  if (outputRaw === undefined) {
    const nested = root.response;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      outputRaw = nested.output;
    }
  }
  if (outputRaw === undefined || outputRaw == null) return { items: [] as any[], complete: false };

  let output;
  try {
    output = Array.isArray(outputRaw) ? outputRaw : JSON.parse(outputRaw);
  } catch {
    return { items: [] as any[], complete: false };
  }
  if (!Array.isArray(output)) return { items: [] as any[], complete: false };

  const items: any[] = [];
  for (const item of output) {
    const typeName = typeof item === "object" && item ? String(item.type ?? "").trim() : "";
    if (REPLAY_ITEM_TYPES.has(typeName)) {
      items.push(cloneValue(item));
    }
  }
  return { items, complete: true };
}

// normalizeReplayItems: normalize each item; require at least one "anchor" item
// (reasoning/function_call/custom_tool_call). Returns { items, ok }.
export function normalizeReplayItems(items: any) {
  if (!Array.isArray(items)) return { items: [] as any[], ok: false };
  const normalized: any[] = [];
  let hasAnchor = false;
  for (const item of items) {
    const next = normalizeReplayItem(item);
    if (!next) continue;
    normalized.push(next);
    const typeName = String(next.type ?? "").trim();
    if (typeName === "reasoning" || typeName === "function_call" || typeName === "custom_tool_call") {
      hasAnchor = true;
    }
  }
  return { items: normalized, ok: hasAnchor && normalized.length > 0 };
}

function normalizeReplayItem(item: any) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const typeName = String(item.type ?? "").trim();
  switch (typeName) {
    case "reasoning":
      return normalizeReasoningItem(item);
    case "message":
      return normalizeAssistantMessageItem(item);
    case "function_call":
      return normalizeFunctionCallItem(item);
    case "custom_tool_call":
      return normalizeCustomToolCallItem(item);
    default:
      return null;
  }
}

// normalizeReasoningItem: require a valid encrypted_content blob. Drops summary/content
// noise — encrypted_content is the continuity token; summary is not reliable across hops.
function normalizeReasoningItem(raw: any) {
  const encrypted = raw.encrypted_content;
  if (typeof encrypted !== "string" || !validGrokReplayEncryptedContent(encrypted)) return null;
  return {
    type: "reasoning",
    summary: [] as any[],
    content: null,
    encrypted_content: encrypted,
  };
}

// validGrokReplayEncryptedContent: base64-decodable, >=50 decoded bytes,
// Shannon entropy ratio >= 0.85. Rejects Fernet tokens (gAAAA prefix) and =-padding
// (standard base64, not raw) which Grok Build never emits for reasoning continuity.
export function validGrokReplayEncryptedContent(value: any) {
  if (typeof value !== "string" || value === "" || value !== value.trim()) return false;
  if (value.length > REPLAY_CONSTANTS.MAX_ENCRYPTED_LEN) return false;
  if (value.startsWith("gAAAA") || value.includes("=")) return false;
  // Raw base64 alphabet (standard + URL-safe chars, no padding).
  if (!/^[A-Za-z0-9+/_-]+$/.test(value)) return false;
  // Node's Buffer.from(str, "base64") is lenient (skips invalid chars), so verify by
  // round-tripping: re-encode the decoded bytes (raw, no padding) and require equality.
  let decoded;
  try {
    decoded = Buffer.from(value, "base64");
  } catch {
    return false;
  }
  if (!decoded || decoded.length < REPLAY_CONSTANTS.MIN_ENCRYPTED_DECODED_LEN) return false;
  const reEncoded = decoded.toString("base64").replace(/=+$/, "");
  if (reEncoded !== value) return false; // input wasn't clean base64
  return replayByteEntropyRatio(decoded) >= REPLAY_CONSTANTS.MIN_ENCRYPTED_ENTROPY;
}

// replayByteEntropyRatio: Shannon entropy normalized to [0,1]. High entropy => real
// opaque encrypted blob; low entropy => plaintext masquerading as encrypted_content.
export function replayByteEntropyRatio(value: any) {
  if (!value || value.length === 0) return 0;
  const counts = new Array(256).fill(0);
  for (let i = 0; i < value.length; i++) counts[value[i]]++;
  const size = value.length;
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const probability = count / size;
    entropy -= probability * Math.log2(probability);
  }
  const maxSymbols = Math.min(size, 256);
  if (maxSymbols <= 1) return 0;
  return entropy / Math.log2(maxSymbols);
}

// normalizeAssistantMessageItem: only keep role:"assistant" with output_text/refusal parts.
function normalizeAssistantMessageItem(raw: any) {
  const role = String(raw.role ?? "").trim();
  if (role.toLowerCase() !== "assistant") return null;
  const content = raw.content;
  let parts;
  try {
    parts = Array.isArray(content) ? content : typeof content === "string" ? null : JSON.parse(content);
  } catch {
    return null;
  }
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const out: any[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const partType = String(part.type ?? "").trim();
    if (partType === "output_text") {
      const text = part.text;
      if (typeof text !== "string") continue;
      out.push({ type: "output_text", text });
    } else if (partType === "refusal") {
      const refusal = part.refusal;
      if (typeof refusal !== "string") continue;
      out.push({ type: "refusal", refusal });
    }
  }
  if (out.length === 0) return null;
  return { type: "message", role: "assistant", content: out };
}

// normalizeFunctionCallItem: require call_id + name + arguments.
function normalizeFunctionCallItem(raw: any) {
  const callID = typeof raw.call_id === "string" ? raw.call_id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  let argumentsStr = raw.arguments;
  if (typeof argumentsStr !== "string") {
    try {
      argumentsStr = JSON.stringify(argumentsStr ?? "");
    } catch {
      return null;
    }
  }
  if (callID === "" || name === "") return null;
  return { type: "function_call", call_id: callID, name, arguments: argumentsStr };
}

// normalizeCustomToolCallItem: require call_id + name + non-empty input.
function normalizeCustomToolCallItem(raw: any) {
  const callID = typeof raw.call_id === "string" ? raw.call_id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (callID === "" || name === "" || raw.input === undefined || raw.input === null) return null;
  const out: any = { type: "custom_tool_call", status: "completed", call_id: callID, name };
  const status = raw.status;
  if (typeof status === "string" && status.trim() !== "") out.status = status;
  try {
    // Validate input is serializable; keep as-is.
    JSON.stringify(raw.input);
    out.input = raw.input;
  } catch {
    return null;
  }
  return out;
}

function cloneValue(value: any) {
  return JSON.parse(JSON.stringify(value));
}
