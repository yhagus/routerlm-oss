// reasoningReplay/capture.js
// Ported from grok2api backend/internal/pkg/reasoningreplay/capture.go
// Reconstructs a completed Responses JSON payload from an SSE stream so the prior turn's
// output items (reasoning / function_call / assistant) can be cached for the next turn.
//
// Two entry points:
//   - extractCompletedPayloadFromSSE(rawString): parse a whole SSE buffer at once.
//   - createReplayCaptureContext(): observe parsed payloads incrementally as they flow
//     through the stream normalizer, then materialize the completed payload on stream end.

const MAX_REPLAY_CAPTURE_BYTES = 8 << 20; // 8 MiB

// extractCompletedPayloadFromSSE: scan SSE `data:` lines; collect items from
// `response.output_item.done` (indexed by output_index) and capture the final
// `response.completed`/`response.done` event. If that event's response.output is
// missing, patch it from the collected items. Returns { payload, ok } (parsed object).
export function extractCompletedPayloadFromSSE(data: any) {
  if (typeof data !== "string") data = String(data ?? "");
  if (data.length > MAX_REPLAY_CAPTURE_BYTES) return { payload: null, ok: false };

  const lines = data.split("\n");
  let lastEvent = null;
  const itemsByIndex = new Map();
  const fallbackItems: any[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const value = trimmed.slice(5).trim();
    if (value === "" || value === "[DONE]") continue;

    let typed;
    try {
      typed = JSON.parse(value);
    } catch {
      continue;
    }
    if (!typed || typeof typed !== "object") continue;
    const type = String(typed.type ?? "").trim();

    switch (type) {
      case "response.output_item.done": {
        const item = typed.item;
        if (!item || typeof item !== "object") continue;
        const idx = typed.output_index;
        if (typeof idx === "number" && Number.isFinite(idx)) {
          itemsByIndex.set(idx, cloneValue(item));
        } else {
          fallbackItems.push(cloneValue(item));
        }
        break;
      }
      case "response.completed":
      case "response.done": {
        if (typed.response && typeof typed.response === "object") {
          lastEvent = patchCompletedOutput(typed, itemsByIndex, fallbackItems);
        } else if (typed.output) {
          lastEvent = cloneValue(typed);
        }
        break;
      }
      default: {
        if (typed.output && type === "") {
          lastEvent = cloneValue(typed);
        }
      }
    }
  }
  return { payload: lastEvent, ok: lastEvent !== null };
}

// patchCompletedOutput: if the `response.completed` event's response.output array is
// absent/empty, build it from the indexed items (sorted) followed by fallback items.
// Returns a (possibly patched) clone of the event object.
export function patchCompletedOutput(event: any, itemsByIndex: any, fallbackItems: any) {
  if ((itemsByIndex.size === 0 && fallbackItems.length === 0) || !event) {
    return cloneValue(event);
  }
  const root = cloneValue(event);
  const response = root.response;
  if (!response || typeof response !== "object") return root;
  // If response already carries a non-empty output array, trust it.
  if (Array.isArray(response.output) && response.output.length > 0) return root;
  const indexes = Array.from(itemsByIndex.keys()).sort((a: any, b: any) => a - b);
  const output: any[] = [];
  for (const idx of indexes) output.push(itemsByIndex.get(idx));
  for (const item of fallbackItems) output.push(item);
  response.output = output;
  return root;
}

// createReplayCaptureContext: incremental observer for the streaming path. Feed every
// parsed SSE payload to observe(); call getCompletedPayload() at stream end.
export function createReplayCaptureContext() {
  let finalEvent: any = null;
  let patched = false;
  const itemsByIndex = new Map();
  const fallbackItems: any[] = [];

  function observe(payload: any) {
    if (!payload || typeof payload !== "object") return;
    const type = String(payload.type ?? "").trim();
    switch (type) {
      case "response.output_item.added":
      case "response.output_item.done": {
        const item = payload.item;
        if (!item || typeof item !== "object") return;
        const idx = payload.output_index;
        // Only finalize on `.done`; `.added` is buffered in case `.done` is never sent
        // (some upstreams emit only added+completed). On `.done` we overwrite.
        if (type === "response.output_item.done") {
          if (typeof idx === "number" && Number.isFinite(idx)) {
            itemsByIndex.set(idx, cloneValue(item));
          } else {
            fallbackItems.push(cloneValue(item));
          }
        }
        return;
      }
      case "response.completed":
      case "response.done": {
        if (payload.response && typeof payload.response === "object") {
          finalEvent = patchCompletedOutput(payload, itemsByIndex, fallbackItems);
          patched = true;
        } else if (payload.output) {
          finalEvent = cloneValue(payload);
          patched = true;
        }
        return;
      }
      default:
        return;
    }
  }

  function getCompletedPayload() {
    if (finalEvent) return { payload: cloneValue(finalEvent), ok: true };
    // No explicit completed event seen (early close). Best-effort: if we gathered any
    // output items, synthesize a minimal completed payload carrying them.
    if (itemsByIndex.size === 0 && fallbackItems.length === 0) return { payload: null, ok: false };
  const indexes = Array.from(itemsByIndex.keys()).sort((a: any, b: any) => a - b);
    const output: any[] = [];
    for (const idx of indexes) output.push(itemsByIndex.get(idx));
    for (const item of fallbackItems) output.push(item);
    return { payload: { output }, ok: true };
  }

  return { observe, getCompletedPayload };
}

function cloneValue(value: any) {
  return JSON.parse(JSON.stringify(value));
}
