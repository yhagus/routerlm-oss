import type { IncomingMessage, ServerResponse } from "node:http";
import { clientDisconnectSignal } from "./event-stream-response.js";

/** What the inference path needs to know about the client's HTTP exchange. */
export interface ClientConnection {
  /** Aborts when the client goes away before the response is fully sent. */
  signal: AbortSignal;
  /** The request body's size on the wire, for the Usage Log. */
  requestBytes: number;
}

export function clientConnectionOf(
  request: IncomingMessage,
  response: ServerResponse,
): ClientConnection {
  return { signal: clientDisconnectSignal(response), requestBytes: requestBytesOf(request) };
}

/** The declared body size; 0 for a chunked body, which declares none. */
export function requestBytesOf(request: IncomingMessage): number {
  const contentLength = Number(request.headers["content-length"]);
  return Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : 0;
}
