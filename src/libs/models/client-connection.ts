import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { NodeRequest } from "@nestjs/platform-node";
import { USER_AGENT_MAX_LENGTH } from "@/db/schemas/index.js";
import { clientDisconnectSignal } from "./event-stream-response.js";

/** What the inference path needs to know about the client's HTTP exchange. */
export interface ClientConnection {
  /** Aborts when the client goes away before the response is fully sent. */
  signal: AbortSignal;
  /** The request body's size on the wire, for the Usage Log. */
  requestBytes: number;
  /** For an Error Capture, should the request fail. */
  requestHeaders: IncomingHttpHeaders;
  sender: RequestSender;
}

/** Which client software sent the request, and from where (ADR 0032). */
export interface RequestSender {
  /** Truncated to USER_AGENT_MAX_LENGTH; null when the client sent none. */
  userAgent: string | null;
  /**
   * As the HTTP adapter resolves it through `TRUST_PROXY`: from
   * `X-Forwarded-For` only for a trusted proxy, else the socket's address.
   */
  clientIp: string | null;
}

export function clientConnectionOf(
  request: IncomingMessage,
  response: ServerResponse,
): ClientConnection {
  return {
    signal: clientDisconnectSignal(response),
    requestBytes: requestBytesOf(request),
    requestHeaders: request.headers,
    sender: requestSenderOf(request),
  };
}

export function requestSenderOf(request: IncomingMessage): RequestSender {
  const userAgent = request.headers["user-agent"];
  return {
    userAgent: userAgent === undefined ? null : userAgent.slice(0, USER_AGENT_MAX_LENGTH),
    // Every request of @nestjs/platform-node's adapter is a NodeRequest.
    clientIp: request instanceof NodeRequest ? (request.ip ?? null) : null,
  };
}

/** The declared body size; 0 for a chunked body, which declares none. */
export function requestBytesOf(request: IncomingMessage): number {
  const contentLength = Number(request.headers["content-length"]);
  return Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : 0;
}
