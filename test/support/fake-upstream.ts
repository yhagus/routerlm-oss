import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** What the fake upstream answers to the next request. */
export type FakeReply =
  /** `delayMs` holds the whole answer back, as a slow but healthy non-stream upstream. */
  | {
      kind: "json";
      status: number;
      body: unknown;
      headers?: Record<string, string>;
      delayMs?: number;
    }
  /** `events` is raw server-sent-event text; `holdOpen` keeps the connection open afterwards. */
  | { kind: "stream"; events: string; holdOpen?: boolean }
  /** Sends the stream's first events, then drops the connection. */
  | { kind: "stream-then-reset"; events: string }
  /** Never sends headers, as an upstream that stopped answering. */
  | { kind: "hang" }
  /** Sends a 200 and its headers, then nothing: no body, no stream event. */
  | { kind: "headers-only" }
  /** Drops the connection without answering. */
  | { kind: "reset" };

/** A request the fake upstream received. */
export interface ReceivedRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: unknown;
  /** The body exactly as sent, for checks on its bytes. */
  rawBody: string;
}

/** Sent with every reply, to prove upstream headers never reach the client. */
export const UPSTREAM_ONLY_HEADER = "x-upstream-request-id";

/** A recorded upstream fixture from the openai-chat converter's tests. */
export function openAiChatFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/openai-chat/fixtures/${name}`, import.meta.url),
    "utf8",
  );
}

/** A recorded upstream fixture from the anthropic-messages converter's tests. */
export function anthropicMessagesFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/anthropic-messages/fixtures/${name}`, import.meta.url),
    "utf8",
  );
}

/**
 * A local HTTP server standing in for a Provider, so no test calls a real
 * one. Queue replies with `reply()`; each request takes the next one.
 */
export class FakeUpstream {
  readonly requests: ReceivedRequest[] = [];
  private readonly replies: FakeReply[] = [];
  private readonly openResponses = new Set<ServerResponse>();
  private disconnectWaiters: Array<() => void> = [];

  private constructor(private readonly server: Server) {}

  static async start(): Promise<FakeUpstream> {
    const server = createServer();
    const upstream = new FakeUpstream(server);
    server.on("request", (request, response) => void upstream.handle(request, response));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return upstream;
  }

  /** What a Provider row's base URL should be. */
  get baseUrl(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/v1`;
  }

  get lastRequest(): ReceivedRequest {
    const last = this.requests.at(-1);
    if (!last) {
      throw new Error("The fake upstream received no request");
    }
    return last;
  }

  reply(reply: FakeReply): void {
    this.replies.push(reply);
  }

  /** Resolves when the gateway closes a connection the fake upstream was still answering. */
  waitForDisconnect(): Promise<void> {
    return new Promise((resolve) => this.disconnectWaiters.push(resolve));
  }

  reset(): void {
    this.requests.length = 0;
    this.replies.length = 0;
    this.closeOpenResponses();
  }

  async close(): Promise<void> {
    this.closeOpenResponses();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    this.requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      headers: request.headers,
      body: text === "" ? undefined : JSON.parse(text),
      rawBody: text,
    });

    this.openResponses.add(response);
    response.on("close", () => {
      this.openResponses.delete(response);
      if (!response.writableFinished) {
        this.disconnectWaiters.forEach((resolve) => resolve());
        this.disconnectWaiters = [];
      }
    });

    const reply = this.replies.shift();
    if (!reply) {
      response.writeHead(500).end("The fake upstream has no reply queued");
      return;
    }
    switch (reply.kind) {
      case "json":
        setTimeout(() => {
          response.writeHead(reply.status, {
            "content-type": "application/json",
            [UPSTREAM_ONLY_HEADER]: "upstream-123",
            ...reply.headers,
          });
          response.end(JSON.stringify(reply.body));
        }, reply.delayMs ?? 0);
        return;
      case "stream":
        response.writeHead(200, {
          "content-type": "text/event-stream",
          [UPSTREAM_ONLY_HEADER]: "upstream-123",
        });
        response.write(reply.events);
        if (!reply.holdOpen) {
          response.end();
        }
        return;
      case "stream-then-reset":
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(reply.events, () => response.destroy());
        return;
      case "hang":
        return;
      case "headers-only":
        response.writeHead(200, { "content-type": "application/json" });
        response.flushHeaders();
        return;
      case "reset":
        response.destroy();
        return;
    }
  }

  private closeOpenResponses(): void {
    for (const response of this.openResponses) {
      response.destroy();
    }
  }
}
