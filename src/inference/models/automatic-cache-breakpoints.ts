import type { InferenceMessage, InferenceRequest, UserContentPart } from './internal-format';

export const DEFAULT_CACHE_MARKER_LIMIT = 4;

type AddBreakpoint = (request: InferenceRequest) => InferenceRequest;

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
  return parts.some((part) => 'cacheMarker' in part && part.cacheMarker !== undefined);
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
  if (message.role !== 'assistant') {
    return { ...message, content: withLastPartMarked(message.content) };
  }
  const lastText = message.content.findLastIndex(
    (part) => part.type === 'text' && part.text !== '',
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

function withLastPartMarked<Part extends UserContentPart>(parts: Part[]): Part[] {
  const last = parts.findLastIndex((part) => part.type === 'image' || part.text !== '');
  return parts.map((part, index) => (index === last ? { ...part, cacheMarker: {} } : part));
}
