import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { NodeRequest } from "@nestjs/platform-node";
import { USER_AGENT_MAX_LENGTH } from "@/db/schemas";
import { clientDisconnectSignal } from "./event-stream-response";

export interface ClientConnection {
  signal: AbortSignal;
  requestBytes: number;
  requestHeaders: IncomingHttpHeaders;
  sender: RequestSender;
}

export interface RequestSender {
  userAgent: string | null;
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
    clientIp: request instanceof NodeRequest ? (request.ip ?? null) : null,
  };
}

export function requestBytesOf(request: IncomingMessage): number {
  const contentLength = Number(request.headers["content-length"]);
  return Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : 0;
}
