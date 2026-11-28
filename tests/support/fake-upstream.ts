import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { text as readBody } from 'node:stream/consumers';
import { portOf } from './port-of';

export type FakeReply =
  | {
      kind: 'json';
      status: number;
      body: unknown;
      headers?: Record<string, string>;
      delayMs?: number;
      onReceived?: () => void | Promise<void>;
    }
  | {
      kind: 'stream';
      events: string;
      status?: number;
      holdOpen?: boolean;
      headers?: Record<string, string>;
    }
  | { kind: 'stream-in-pieces'; pieces: Array<string | Uint8Array>; pauseMs?: number }
  | { kind: 'stream-then-reset'; events: string }
  | { kind: 'hang' }
  | { kind: 'headers-only' }
  | { kind: 'reset' }
  | { kind: 'binary'; status: number; contentType: string; body: Uint8Array };

export interface ReceivedRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
  rawBody: string;
}

const PAUSE_BETWEEN_PIECES_MS = 20;

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

export const UPSTREAM_ONLY_HEADER = 'x-upstream-request-id';

export function openAiChatFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/openai-chat/fixtures/${name}`, import.meta.url),
    'utf8',
  );
}

export function anthropicMessagesFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/anthropic-messages/fixtures/${name}`, import.meta.url),
    'utf8',
  );
}

export function anthropicStreamWithOneThinkingDelta(): string {
  return anthropicMessagesFixture('upstream-stream-tool-call.sse')
    .split('\n\n')
    .filter((event) => !event.includes('"thinking":" weather."'))
    .join('\n\n');
}

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
  '',
].join('\n\n');

export function dashScopeImageFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/dashscope-image/fixtures/${name}`, import.meta.url),
    'utf8',
  );
}

export const DASHSCOPE_GENERATION_PATH = '/api/v1/services/aigc/multimodal-generation/generation';

export function replyWithTwoDashScopeImages(
  upstream: FakeUpstream,
  outputSize: { width: number; height: number } = { width: 1024, height: 1024 },
): void {
  const answer = dashScopeImageFixture('upstream-response.json')
    .replace(/https:\/\/[^"]*first\.png[^"]*/, upstream.mediaUrl('/media/a.png'))
    .replace(/https:\/\/[^"]*second\.png[^"]*/, upstream.mediaUrl('/media/b.png'))
    .replace(/"output_width": \d+/, `"output_width": ${outputSize.width}`)
    .replace(/"output_height": \d+/, `"output_height": ${outputSize.height}`);
  upstream.replyTo(DASHSCOPE_GENERATION_PATH, {
    kind: 'json',
    status: 200,
    body: JSON.parse(answer),
  });
  const imageBytes: FakeReply = {
    kind: 'binary',
    status: 200,
    contentType: 'image/png',
    body: new Uint8Array([1, 2, 3]),
  };
  upstream.replyTo('/media/a.png', imageBytes);
  upstream.replyTo('/media/b.png', imageBytes);
}

export function dashScopeTranscriptionFixture(name: string): string {
  return readFileSync(
    new URL(
      `../../src/inference/protocols/dashscope-transcription/fixtures/${name}`,
      import.meta.url,
    ),
    'utf8',
  );
}

export function dashScopeVideoFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/dashscope-video/fixtures/${name}`, import.meta.url),
    'utf8',
  );
}

export function dashScopeSpeechFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/dashscope-speech/fixtures/${name}`, import.meta.url),
    'utf8',
  );
}

export function openAiResponsesFixture(name: string): string {
  return readFileSync(
    new URL(`../../src/inference/protocols/openai-responses/fixtures/${name}`, import.meta.url),
    'utf8',
  );
}

export class FakeUpstream {
  readonly requests: ReceivedRequest[] = [];
  private readonly replies: FakeReply[] = [];
  private readonly repliesByPath = new Map<string, FakeReply[]>();
  private readonly repliesByCredential = new Map<string, FakeReply[]>();
  private readonly openResponses = new Set<ServerResponse>();
  private disconnectWaiters: Array<() => void> = [];

  private constructor(private readonly server: Server) {}

  static async start(): Promise<FakeUpstream> {
    const server = createServer();
    const upstream = new FakeUpstream(server);
    server.on('request', (request, response) => void upstream.handle(request, response));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return upstream;
  }

  get origin(): string {
    return `http://127.0.0.1:${portOf(this.server.address())}`;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${portOf(this.server.address())}/v1`;
  }

  get localhostBaseUrl(): string {
    return `http://localhost:${portOf(this.server.address())}/v1`;
  }

  mediaUrl(path: string): string {
    return `${this.origin}${path}`;
  }

  get lastRequest(): ReceivedRequest {
    const last = this.requests.at(-1);
    if (!last) {
      throw new Error('The fake upstream received no request');
    }
    return last;
  }

  reply(reply: FakeReply): void {
    this.replies.push(reply);
  }

  replyTo(path: string, reply: FakeReply): void {
    const replies = this.repliesByPath.get(path) ?? [];
    replies.push(reply);
    this.repliesByPath.set(path, replies);
  }

  replyWithCredential(credential: string, reply: FakeReply): void {
    const replies = this.repliesByCredential.get(credential) ?? [];
    replies.push(reply);
    this.repliesByCredential.set(credential, replies);
  }

  waitForDisconnect(): Promise<void> {
    return new Promise((resolve) => this.disconnectWaiters.push(resolve));
  }

  reset(): void {
    this.requests.length = 0;
    this.replies.length = 0;
    this.repliesByPath.clear();
    this.repliesByCredential.clear();
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
      method: request.method ?? '',
      path: request.url ?? '',
      headers: request.headers,
      body: parsedBody(text, request.headers['content-type']),
      rawBody: text,
    });

    this.openResponses.add(response);
    response.on('close', () => {
      this.openResponses.delete(response);
      if (!response.writableFinished) {
        this.disconnectWaiters.forEach((resolve) => resolve());
        this.disconnectWaiters = [];
      }
    });

    const reply =
      this.repliesByPath.get(request.url ?? '')?.shift() ??
      this.repliesByCredential.get(credentialOf(request))?.shift() ??
      this.replies.shift();
    if (!reply) {
      response.writeHead(500).end('The fake upstream has no reply queued');
      return;
    }
    switch (reply.kind) {
      case 'json':
        void Promise.resolve(reply.onReceived?.()).then(() => {
          setTimeout(() => {
            response.writeHead(reply.status, {
              'content-type': 'application/json',
              [UPSTREAM_ONLY_HEADER]: 'upstream-123',
              ...reply.headers,
            });
            response.end(JSON.stringify(reply.body));
          }, reply.delayMs ?? 0);
        });
        return;
      case 'stream':
        response.writeHead(reply.status ?? 200, {
          'content-type': 'text/event-stream',
          [UPSTREAM_ONLY_HEADER]: 'upstream-123',
          ...reply.headers,
        });
        response.write(reply.events);
        if (!reply.holdOpen) {
          response.end();
        }
        return;
      case 'stream-in-pieces':
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        await writeInPieces(response, reply.pieces, reply.pauseMs ?? PAUSE_BETWEEN_PIECES_MS);
        response.end();
        return;
      case 'stream-then-reset':
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(reply.events, () => response.destroy());
        return;
      case 'hang':
        return;
      case 'headers-only':
        response.writeHead(200, { 'content-type': 'application/json' });
        response.flushHeaders();
        return;
      case 'reset':
        response.destroy();
        return;
      case 'binary':
        response.writeHead(reply.status, { 'content-type': reply.contentType });
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

function parsedBody(text: string, contentType: string | undefined): unknown {
  if (text === '') {
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
  pauseMs: number,
): Promise<void> {
  for (const piece of pieces) {
    response.write(piece);
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
}

function credentialOf(request: IncomingMessage): string {
  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string') {
    return apiKey;
  }
  return request.headers.authorization?.replace(/^Bearer /, '') ?? '';
}
