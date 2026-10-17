const MAX_FUNCTION_ARGUMENT_BYTES = 1 << 20;
const MAX_TOTAL_FUNCTION_ARGUMENT_BYTES = 4 << 20;

function callKey(payload: any) {
  const item = payload?.item;
  const id = payload?.item_id || payload?.call_id || item?.id || item?.call_id;
  if (id) return String(id);
  return Number.isInteger(payload?.output_index) ? `output:${payload.output_index}` : null;
}

function normalizeArguments(argumentsText: any) {
  if (typeof argumentsText !== "string") return argumentsText;
  try {
    // JSON.stringify turns whole numeric values such as 60000.0 into 60000,
    // which keeps Grok's output compatible with integer tool schemas.
    return JSON.stringify(JSON.parse(argumentsText));
  } catch {
    // Invalid arguments must reach the client unchanged so its tool-result
    // recovery loop can show the model the exact syntax error.
    return argumentsText;
  }
}

/**
 * Buffer Grok function argument deltas until the completed Responses event.
 * Clients that eagerly validate streamed tool calls then see one complete,
 * canonical JSON payload instead of partially assembled arguments.
 */
function restoreToolAlias(payload: any, toolAliases: any) {
  const item = payload?.item;
  if (!toolAliases?.size || item?.type !== "function_call") return payload;
  const identity = toolAliases.get(item.name);
  if (!identity || typeof identity !== "object") return payload;
  return {
    ...payload,
    item: {
      ...item,
      name: identity.name,
      namespace: identity.namespace,
    },
  };
}

export function restoreGrokCliResponseToolAliases(value: any, toolAliases: any) {
  if (!toolAliases?.size || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) restoreGrokCliResponseToolAliases(item, toolAliases);
    return value;
  }
  for (const child of Object.values(value)) restoreGrokCliResponseToolAliases(child, toolAliases);
  if (value.type !== "function_call") return value;
  const identity = toolAliases.get(value.name);
  if (!identity || typeof identity !== "object") return value;
  value.name = identity.name;
  value.namespace = identity.namespace;
  return value;
}

export function createGrokCliResponsesStreamNormalizer(toolAliases: any = null, captureCtx: any = null) {
  const calls = new Map();
  let bufferedBytes = 0;

  return function normalize(payload: any, eventName = "") {
    if (!payload || typeof payload !== "object") return payload;
    // Feed the upstream payload to the reasoning-replay capture context (no-op when no
    // captureCtx is wired). observe() only acts on response.output_item.done and
    // response.completed/response.done, so deltas/control frames are ignored cheaply.
    if (captureCtx) captureCtx.observe(payload);
    const type = payload.type || eventName;

    // This is a Grok CLI transport control frame, not a Responses API event.
    if (type === "response.doom_loop_check") return null;

    if (type === "response.output_item.added" || type === "response.output_item.done") {
      payload = restoreToolAlias(payload, toolAliases);
    }

    if (type === "response.function_call_arguments.delta") {
      const key = callKey(payload);
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      if (!key || !delta) return payload;

      const call = calls.get(key) || { arguments: "", passthrough: false };
      if (!call.passthrough && (
        call.arguments.length + delta.length > MAX_FUNCTION_ARGUMENT_BYTES ||
        bufferedBytes + delta.length > MAX_TOTAL_FUNCTION_ARGUMENT_BYTES
      )) {
        // Release already buffered content before falling back to native deltas.
        payload = { ...payload, delta: call.arguments + delta };
        bufferedBytes -= call.arguments.length;
        call.arguments = "";
        call.passthrough = true;
      } else if (!call.passthrough) {
        call.arguments += delta;
        bufferedBytes += delta.length;
        calls.set(key, call);
        return null;
      }
      calls.set(key, call);
      return payload;
    }

    if (type === "response.function_call_arguments.done") {
      const key = callKey(payload);
      const call = key ? calls.get(key) : null;
      if (call && !call.passthrough) {
        bufferedBytes -= call.arguments.length;
        const argumentsText = typeof payload.arguments === "string" ? payload.arguments : call.arguments;
        const normalized = normalizeArguments(argumentsText);
        calls.set(key, { arguments: normalized, completed: true, passthrough: false });
        return { ...payload, arguments: normalized };
      }
      return { ...payload, arguments: normalizeArguments(payload.arguments) };
    }

    if (type === "response.output_item.done" && payload.item?.type === "function_call") {
      const key = callKey(payload);
      const call = key ? calls.get(key) : null;
      const argumentsText = call?.completed
        ? call.arguments
        : normalizeArguments(payload.item.arguments);
      if (key) calls.delete(key);
      if (typeof argumentsText !== "string") return payload;
      return { ...payload, item: { ...payload.item, arguments: argumentsText } };
    }

    return payload;
  };
}
