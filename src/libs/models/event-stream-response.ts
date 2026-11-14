import type { ServerResponse } from "node:http";

const EVENT_STREAM_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  // Stops proxies such as nginx from buffering the stream.
  "x-accel-buffering": "no",
};

/**
 * A web Response streaming `chunks` as server-sent events, returned from a
 * plain `@Post` handler (ADR 0005). Nest cancels its body as soon as the
 * client disconnects, which stops reading `chunks` (and so the upstream call).
 */
export function eventStreamResponse(chunks: AsyncIterable<string>): Response {
  const iterator = chunks[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(next.value));
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  return new Response(body, { status: 200, headers: EVENT_STREAM_HEADERS });
}

/** Aborts when the client goes away before the response is fully sent. */
export function clientDisconnectSignal(response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableFinished) {
      controller.abort();
    }
  });
  return controller.signal;
}
