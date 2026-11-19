import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { text as readBody } from "node:stream/consumers";
import { portOf } from "./port-of.js";

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
  /**
   * Sends a stream in `pieces`, pausing between them so the gateway reads
   * each one on its own, as a stream split across network packets.
   */
  | { kind: "stream-in-pieces"; pieces: Array<string | Uint8Array> }
  /** Sends the stream's first events, then drops the connection. */
  | { kind: "stream-then-reset"; events: string }
  /** Never sends headers, as an upstream that stopped answering. */
  | { kind: "hang" }
  /** Sends a 200 and its headers, then nothing: no body, no stream event. */
  | { kind: "headers-only" }
  /** Drops the connection without answering. */
  | { kind: "reset" }
  /** Raw bytes with their content type, as a media host serves a generated file. */
  | { kind: "binary"; status: number; contentType: string; body: Uint8Array };

/** A request the fake upstream received. */
export interface ReceivedRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: unknown;
  /** The body exactly as sent, for checks on its bytes. */
  rawBody: string;
}

/** Long enough for the gateway to read one piece of a stream before the next is sent. */
const PAUSE_BETWEEN_PIECES_MS = 20;

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

/** Sent with every reply, to prove upstream headers never reach the client. */
export const UPSTREAM_ONLY_HEADER = "x-upstream-request-id";

/** A recorded openai-chat exchange: what an upstream gets or sends (`upstream-*`), or a client (`client-*`). */
export function openAiChatFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/openai-chat/fixtures/${name}`, import.meta.url),
    "utf8",
  );
}

/** A recorded anthropic-messages exchange, named as for openAiChatFixture. */
export function anthropicMessagesFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/anthropic-messages/fixtures/${name}`, import.meta.url),
    "utf8",
  );
}

/**
 * The anthropic-messages upstream's recorded stream, but with its thinking in
 * one delta, as the client fixtures (`client-stream.sse`) were recorded from.
 */
export function anthropicStreamWithOneThinkingDelta(): string {
  return anthropicMessagesFixture("upstream-stream-tool-call.sse")
    .split("\n\n")
    .filter((event) => !event.includes('"thinking":" weather."'))
    .join("\n\n");
}

/** An anthropic-messages stream of two thinking blocks, the first one signed. */
export const TWO_THINKING_BLOCKS_STREAM = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_up","type":"message","role":"assistant","model":"claude-test-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":5,"output_tokens":1}}}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"First."}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-1"}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"thinking","thinking":"","signature":""}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"Second."}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":3}}',
  'event: message_stop\ndata: {"type":"message_stop"}',
  "",
].join("\n\n");

/** A recorded dashscope-image exchange, named as for openAiChatFixture. */
export function dashScopeImageFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/dashscope-image/fixtures/${name}`, import.meta.url),
    "utf8",
  );
}

/** A recorded openai-responses exchange, named as for openAiChatFixture. */
export function openAiResponsesFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/openai-responses/fixtures/${name}`, import.meta.url),
    "utf8",
  );
}

/**
 * A local HTTP server standing in for a Provider, so no test calls a real
 * one. Queue replies with `reply()`; each request takes the next one. A reply
 * queued with `replyTo()` goes only to a request for its path.
 */
export class FakeUpstream {
  readonly requests: ReceivedRequest[] = [];
  private readonly replies: FakeReply[] = [];
  private readonly repliesByPath = new Map<string, FakeReply[]>();
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

  /** Scheme, host and port, without a path: what plays a Provider's auth host. */
  get origin(): string {
    return `http://127.0.0.1:${portOf(this.server.address())}`;
  }

  /** What a Provider row's base URL should be. */
  get baseUrl(): string {
    return `http://127.0.0.1:${portOf(this.server.address())}/v1`;
  }

  /** As `baseUrl`, through the name `localhost` rather than the loopback address, so the host has to be resolved. */
  get localhostBaseUrl(): string {
    return `http://localhost:${portOf(this.server.address())}/v1`;
  }

  /** A URL on the fake for a generated file, as a Provider returns one; queue its bytes with `replyTo(path, ...)`. */
  mediaUrl(path: string): string {
    return `${this.origin}${path}`;
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

  /**
   * Queues a reply for the next request to `path`, whichever other requests
   * arrive first: for a request the gateway makes on the side, at no fixed moment.
   */
  replyTo(path: string, reply: FakeReply): void {
    const replies = this.repliesByPath.get(path) ?? [];
    replies.push(reply);
    this.repliesByPath.set(path, replies);
  }

  /** Resolves when the gateway closes a connection the fake upstream was still answering. */
  waitForDisconnect(): Promise<void> {
    return new Promise((resolve) => this.disconnectWaiters.push(resolve));
  }

  reset(): void {
    this.requests.length = 0;
    this.replies.length = 0;
    this.repliesByPath.clear();
    this.closeOpenResponses();
  }

  async close(): Promise<void> {
    this.closeOpenResponses();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const text = await readBody(request);
    this.requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      headers: request.headers,
      body: parsedBody(text, request.headers["content-type"]),
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

    const reply = this.repliesByPath.get(request.url ?? "")?.shift() ?? this.replies.shift();
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
      case "stream-in-pieces":
        response.writeHead(200, { "content-type": "text/event-stream" });
        await writeInPieces(response, reply.pieces);
        response.end();
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
      case "binary":
        response.writeHead(reply.status, { "content-type": reply.contentType });
        response.end(reply.body);
        return;
    }
  }

  private closeOpenResponses(): void {
    for (const response of this.openResponses) {
      response.destroy();
    }
  }
}

/** A JSON body parsed, or a form's fields by name, as an auth host receives them. */
function parsedBody(text: string, contentType: string | undefined): unknown {
  if (text === "") {
    return undefined;
  }
  if (contentType?.startsWith(FORM_CONTENT_TYPE)) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return JSON.parse(text);
}

async function writeInPieces(
  response: ServerResponse,
  pieces: Array<string | Uint8Array>,
): Promise<void> {
  for (const piece of pieces) {
    response.write(piece);
    await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_PIECES_MS));
  }
}
