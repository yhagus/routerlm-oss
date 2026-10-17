export interface SseWriter {
  data(value: unknown): boolean;
  event(name: string, value: unknown): boolean;
  comment(value: string): boolean;
  close(): void;
  get closed(): boolean;
}

export type SseInitializer = (writer: SseWriter) => void | (() => void);

export const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

export function createSseResponse(request: Request, initialize: SseInitializer): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

  function close(): void {
    if (closed) return;
    closed = true;
    cleanup?.();
    cleanup = undefined;
    try {
      controllerRef?.close();
    } catch {
      // The stream may already be closed by the consumer.
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      const write = (value: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(value));
          return true;
        } catch {
          close();
          return false;
        }
      };

      const writer: SseWriter = {
        data(value) {
          return write(`data: ${JSON.stringify(value)}\n\n`);
        },
        event(name, value) {
          return write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
        },
        comment(value) {
          return write(`: ${value}\n\n`);
        },
        close,
        get closed() {
          return closed;
        },
      };

      const result = initialize(writer);
      if (typeof result === "function") cleanup = result;
    },
    cancel() {
      close();
    },
  });

  request.signal.addEventListener("abort", close, { once: true });
  return new Response(stream, { headers: SSE_HEADERS });
}
