// reasoningReplay/apply.js
// Ported from grok2api backend/internal/pkg/reasoningreplay/input.go
// Request-side injection: re-insert cached reasoning/tool-call/assistant items into the
// outbound body.input so upstream Grok Build keeps multi-turn sessions coherent even
// when the client (e.g. Claude Code) drops the encrypted_content blob.

const ANTHROPIC_PREFIX = "toolu_";

// applyReplay: public entry. Filters cached items against the request body's existing
// input, then inserts the survivors at the correct position. Returns { body, injected }.
export function applyReplay(body: any, items: any) {
  if (!body || !Array.isArray(items) || items.length === 0) return { body, injected: 0 };
  if (!Array.isArray(body.input) || body.input.length === 0) return { body, injected: 0 };
  const filtered = filterReplayItemsForInput(body, items);
  if (filtered.length === 0) return { body, injected: 0 };
  const { body: updated, ok } = insertReplayItems(body, filtered);
  return { body: ok ? updated : body, injected: ok ? filtered.length : 0 };
}

// filterReplayItemsForInput: drop cached items that would duplicate existing input state.
// - reasoning: skip if its encrypted_content is already present in the input
// - assistant message: skip if it already matches the input's last assistant message
// - function_call/custom_tool_call: keep only if a matching function_call_output exists
//   in the input (rewriting the call_id to match the output's id form, incl. toolu_).
export function filterReplayItemsForInput(body: any, items: any) {
  if (!Array.isArray(body.input) || body.input.length === 0) return [];
  const inputItems: any[] = [];
  for (const raw of body.input) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) inputItems.push(raw);
  }

  const [lastAssistant, hasLastAssistant] = lastAssistantMessage(inputItems);
  const [cachedAssistant, hasCachedAssistant] = replayAssistantMessage(items);
  const assistantMatches =
    hasLastAssistant && hasCachedAssistant && assistantContentEqual(lastAssistant, cachedAssistant);
  // If both an input assistant and a cached assistant exist but they diverge, the cached
  // reasoning no longer matches this conversation — skip everything.
  if (hasLastAssistant && hasCachedAssistant && !assistantMatches) return [];

  const existingCalls = new Set();
  const existingOutputs = new Map(); // candidate call-id -> original call-id
  const existingEncrypted = new Set();
  for (const item of inputItems) {
    const typeName = String(item.type ?? "").trim();
    switch (typeName) {
      case "reasoning": {
        const enc = item.encrypted_content;
        if (typeof enc === "string" && enc !== "") existingEncrypted.add(enc);
        break;
      }
      case "function_call_output":
      case "custom_tool_call_output": {
        const callID = typeof item.call_id === "string" ? item.call_id : "";
        for (const candidate of comparableReplayCallIDs(callID)) {
          existingOutputs.set(candidate, callID);
        }
        break;
      }
      case "function_call":
      case "custom_tool_call": {
        const callID = typeof item.call_id === "string" ? item.call_id : "";
        for (const key of replayToolCallKeys(typeName, callID)) existingCalls.add(key);
        break;
      }
    }
  }

  const filtered: any[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const typeName = String(item.type ?? "").trim();
    switch (typeName) {
      case "reasoning": {
        const enc = typeof item.encrypted_content === "string" ? item.encrypted_content : "";
        if (existingEncrypted.has(enc)) continue;
        filtered.push(item);
        break;
      }
      case "message": {
        if (assistantMatches) continue;
        filtered.push(item);
        break;
      }
      case "function_call":
      case "custom_tool_call": {
        const callID = typeof item.call_id === "string" ? item.call_id : "";
        const keys = replayToolCallKeys(typeName, callID);
        if (keys.length === 0 || anyReplayCallKeyExists(existingCalls, keys)) continue;
        let outputCallID = "";
        for (const candidate of comparableReplayCallIDs(callID)) {
          const value = existingOutputs.get(candidate);
          if (value) {
            outputCallID = value;
            break;
          }
        }
        if (outputCallID === "") continue; // no matching tool output in input — skip
        for (const key of keys) existingCalls.add(key);
        filtered.push(outputCallID !== callID ? rewriteReplayCallID(item, outputCallID) : item);
        break;
      }
      default:
        continue;
    }
  }
  return filtered;
}

// comparableReplayCallIDs: normalize between Anthropic toolu_-prefixed ids and bare ids.
// "toolu_abc" -> ["toolu_abc", "abc"]; "abc" -> ["abc", "toolu_abc"].
export function comparableReplayCallIDs(callID: any) {
  if (typeof callID !== "string") callID = String(callID ?? "");
  callID = callID.trim();
  if (callID === "") return [];
  if (callID.startsWith(ANTHROPIC_PREFIX)) {
    const upstreamID = callID.slice(ANTHROPIC_PREFIX.length);
    return upstreamID !== "" ? [callID, upstreamID] : [callID];
  }
  return [callID, ANTHROPIC_PREFIX + callID];
}

export function replayToolCallKeys(itemType: any, callID: any) {
  if (itemType !== "function_call" && itemType !== "custom_tool_call") return [];
  const ids = comparableReplayCallIDs(callID);
  const keys: any[] = [];
  for (const id of ids) keys.push(itemType + "\x00" + id);
  return keys;
}

export function anyReplayCallKeyExists(existing: any, keys: any) {
  for (const key of keys) if (existing.has(key)) return true;
  return false;
}

// rewriteReplayCallID: return a shallow-cloned item with call_id replaced, so the replayed
// tool call aligns with the call_id form the client used in its function_call_output.
export function rewriteReplayCallID(item: any, callID: any) {
  const clone = { ...item, call_id: callID };
  return clone;
}

// lastAssistantMessage: the last input item that is a (type==""|"message") role=assistant.
export function lastAssistantMessage(items: any) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const typeName = String(item.type ?? "").trim();
    const role = String(item.role ?? "").trim();
    if ((typeName !== "" && typeName !== "message") || role.toLowerCase() !== "assistant") continue;
    return [item, true];
  }
  return [null, false];
}

// replayAssistantMessage: the first cached item that is a message role=assistant.
export function replayAssistantMessage(items: any) {
  for (const item of items) {
    const typeName = String(item.type ?? "").trim();
    const role = String(item.role ?? "").trim();
    if (typeName === "message" && role.toLowerCase() === "assistant") return [item, true];
  }
  return [null, false];
}

// assistantContentEqual: compare two assistant messages by their output_text/refusal parts.
export function assistantContentEqual(left: any, right: any) {
  const [leftParts, leftOK] = assistantParts(left ? left.content : undefined);
  const [rightParts, rightOK] = assistantParts(right ? right.content : undefined);
  if (!leftOK || !rightOK || leftParts.length !== rightParts.length) return false;
  for (let i = 0; i < leftParts.length; i++) {
    if (leftParts[i].partType !== rightParts[i].partType) return false;
    if (leftParts[i].value !== rightParts[i].value) return false;
  }
  return true;
}

// assistantParts: normalize content into [{partType, value}]. Accepts a string
// (treated as a single output_text) or an array of output_text/refusal parts.
export function assistantParts(raw: any): any {
  if (raw === undefined || raw === null || raw === "") return [[], false];
  if (typeof raw === "string") return [[{ partType: "output_text", value: raw }], true];
  if (!Array.isArray(raw)) return [[], false];
  const result: any[] = [];
  for (const part of raw) {
    if (!part || typeof part !== "object") continue;
    const partType = String(part.type ?? "").trim();
    switch (partType) {
      case "output_text": {
        if (typeof part.text !== "string") return [[], false];
        result.push({ partType, value: part.text });
        break;
      }
      case "refusal": {
        if (typeof part.refusal !== "string") return [[], false];
        result.push({ partType, value: part.refusal });
        break;
      }
      default:
        return [[], false];
    }
  }
  return [result, result.length > 0];
}

// insertReplayItems: splice filtered items into body.input at replayInsertIndex.
export function insertReplayItems(body: any, replayItems: any) {
  if (!body || !Array.isArray(body.input) || replayItems.length === 0) return { body, ok: false };
  const input = body.input;
  const insertAt = replayInsertIndex(input, replayItems);
  const next: any[] = [];
  for (let i = 0; i < input.length; i++) {
    if (i === insertAt) {
      for (const replay of replayItems) next.push(replay);
    }
    next.push(input[i]);
  }
  if (insertAt === input.length) {
    for (const replay of replayItems) next.push(replay);
  }
  const out = { ...body, input: next };
  return { body: out, ok: true };
}

// replayInsertIndex: where to splice cached items.
//  1. before the first function_call_output whose call_id matches a replayed tool call;
//  2. else after the last assistant message;
//  3. else before the first non-system/developer item;
//  4. else at the end.
export function replayInsertIndex(input: any, replayItems: any) {
  const replayCallIDs = new Set();
  for (const item of replayItems) {
    const typeName = String(item.type ?? "").trim();
    if (typeName !== "function_call" && typeName !== "custom_tool_call") continue;
    const callID = typeof item.call_id === "string" ? item.call_id : "";
    for (const id of comparableReplayCallIDs(callID)) replayCallIDs.add(id);
  }
  if (replayCallIDs.size > 0) {
    for (let i = 0; i < input.length; i++) {
      const raw = input[i];
      const typeName = String(raw.type ?? "").trim();
      if (typeName !== "function_call_output" && typeName !== "custom_tool_call_output") continue;
      const callIDs = comparableReplayCallIDs(typeof raw.call_id === "string" ? raw.call_id : "");
      if (callIDs.length === 0) return i;
      for (const callID of callIDs) {
        if (replayCallIDs.has(callID)) return i;
      }
    }
  }
  for (let i = input.length - 1; i >= 0; i--) {
    const raw = input[i];
    const typeName = String(raw.type ?? "").trim();
    const role = String(raw.role ?? "").trim();
    if ((typeName === "" || typeName === "message") && role.toLowerCase() === "assistant") {
      return i;
    }
  }
  for (let i = 0; i < input.length; i++) {
    if (shouldInsertReplayBefore(input[i])) return i;
  }
  return input.length;
}

// shouldInsertReplayBefore: insert before any item that isn't a system/developer message.
export function shouldInsertReplayBefore(raw: any) {
  if (!raw || typeof raw !== "object") return true;
  const typeName = String(raw.type ?? "").trim();
  const role = String(raw.role ?? "").trim().toLowerCase();
  if (role === "" || (typeName !== "" && typeName !== "message")) return true;
  return role !== "system" && role !== "developer";
}
