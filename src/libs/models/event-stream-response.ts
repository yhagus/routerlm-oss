import type { ServerResponse } from "node:http";

const EVENT_STREAM_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  "x-accel-buffering": "no",
};

export function eventStreamResponse(chunks: AsyncIterable<Uint8Array>): Response {
  const iterator = chunks[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
      } else {
        controller.enqueue(next.value);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  return new Response(body, { status: 200, headers: EVENT_STREAM_HEADERS });
}

export function clientDisconnectSignal(response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableFinished) {
      controller.abort();
    }
  });
  return controller.signal;
}
