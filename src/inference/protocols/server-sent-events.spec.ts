import { readServerSentEvents } from "./server-sent-events.js";

async function* chunksOf(...texts: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  for (const text of texts) {
    yield encoder.encode(text);
  }
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) {
    collected.push(item);
  }
  return collected;
}

describe("readServerSentEvents", () => {
  it("reassembles events split across chunks, with their names", async () => {
    const events = await collect(
      readServerSentEvents(chunksOf("event: ping\nda", 'ta: {"a":1}\n\n', "data: [DONE]\n\n")),
    );

    expect(events).toEqual([
      { event: "ping", data: '{"a":1}' },
      { event: undefined, data: "[DONE]" },
    ]);
  });

  it("accepts CRLF line endings, joins multi-line data and skips comments", async () => {
    const events = await collect(
      readServerSentEvents(chunksOf(": keep-alive\r\n\r\ndata: one\r\ndata: two\r\n\r\n")),
    );

    expect(events).toEqual([{ event: undefined, data: "one\ntwo" }]);
  });

  it("decodes a multi-byte character split between chunks", async () => {
    const bytes = new TextEncoder().encode("data: é\n\n");
    async function* split(): AsyncIterable<Uint8Array> {
      yield bytes.slice(0, 7);
      yield bytes.slice(7);
    }

    const events = await collect(readServerSentEvents(split()));

    expect(events).toEqual([{ event: undefined, data: "é" }]);
  });
});
