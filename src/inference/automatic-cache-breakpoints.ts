import type { InferenceMessage, InferenceRequest, UserContentPart } from "./internal-format.js";

/**
 * Anthropic's limit on cache markers per request, which the Provider's
 * `cacheMarkerLimit` quirk overrides for Providers that differ.
 */
export const DEFAULT_CACHE_MARKER_LIMIT = 4;

type AddBreakpoint = (request: InferenceRequest) => InferenceRequest;

/**
 * Spec "Cache behavior": when the client set no cache markers, mark the end
 * of the tools, the end of the system prompt and the latest turn, so the
 * upstream caches the prompt up to each. A client that set any marker of its
 * own decides alone. With a limit below three, the latest turn goes first:
 * its marker alone caches the whole prompt before it.
 */
export function withAutomaticCacheBreakpoints(
  request: InferenceRequest,
  markerLimit: number,
): InferenceRequest {
  if (hasCacheMarkers(request)) {
    return request;
  }
  const breakpoints: AddBreakpoint[] = [markLatestTurn, markSystemPrompt, markTools];
  return breakpoints
    .slice(0, markerLimit)
    .reduce((marked, addBreakpoint) => addBreakpoint(marked), request);
}

function hasCacheMarkers(request: InferenceRequest): boolean {
  const parts = [
    ...request.system,
    ...request.tools,
    ...request.messages.flatMap((message): object[] => message.content),
  ];
  return parts.some((part) => "cacheMarker" in part && part.cacheMarker !== undefined);
}

function markTools(request: InferenceRequest): InferenceRequest {
  const last = request.tools.at(-1);
  if (!last) {
    return request;
  }
  return { ...request, tools: [...request.tools.slice(0, -1), { ...last, cacheMarker: {} }] };
}

function markSystemPrompt(request: InferenceRequest): InferenceRequest {
  return { ...request, system: withLastPartMarked(request.system) };
}

function markLatestTurn(request: InferenceRequest): InferenceRequest {
  const latest = request.messages.at(-1);
  if (!latest) {
    return request;
  }
  return { ...request, messages: [...request.messages.slice(0, -1), withTurnMarked(latest)] };
}

function withTurnMarked(message: InferenceMessage): InferenceMessage {
  if (message.role !== "assistant") {
    return { ...message, content: withLastPartMarked(message.content) };
  }
  // Only text in an assistant turn can carry a marker.
  const lastText = message.content.findLastIndex(
    (part) => part.type === "text" && part.text !== "",
  );
  if (lastText === -1) {
    return message;
  }
  return {
    ...message,
    content: message.content.map((part, index) =>
      index === lastText ? { ...part, cacheMarker: {} } : part,
    ),
  };
}

/**
 * Marks the last part the upstream will see: Protocols that refuse empty
 * text drop it, and its marker with it.
 */
function withLastPartMarked<Part extends UserContentPart>(parts: Part[]): Part[] {
  const last = parts.findLastIndex((part) => part.type === "image" || part.text !== "");
  return parts.map((part, index) => (index === last ? { ...part, cacheMarker: {} } : part));
}
