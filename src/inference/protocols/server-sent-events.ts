/** One server-sent event: its `event:` name, if any, and its `data:` lines joined. */
export interface ServerSentEvent {
  event: string | undefined;
  data: string;
}

const EVENT_SEPARATOR = /\r?\n\r?\n/;
const LINE_SEPARATOR = /\r?\n/;

/** Reads a server-sent-event byte stream (an upstream's streaming body) event by event. */
export async function* readServerSentEvents(
  body: AsyncIterable<Uint8Array>,
): AsyncIterable<ServerSentEvent> {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of body) {
    buffered += decoder.decode(chunk, { stream: true });
    const blocks = buffered.split(EVENT_SEPARATOR);
    buffered = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseEventBlock(block);
      if (event) {
        yield event;
      }
    }
  }
  const last = parseEventBlock(buffered + decoder.decode());
  if (last) {
    yield last;
  }
}

function parseEventBlock(block: string): ServerSentEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split(LINE_SEPARATOR)) {
    if (line.startsWith("data:")) {
      dataLines.push(fieldValue(line, "data:"));
    } else if (line.startsWith("event:")) {
      event = fieldValue(line, "event:");
    }
    // Comments (":") and other fields (id, retry) mean nothing to an upstream reader.
  }
  if (dataLines.length === 0) {
    return null;
  }
  return { event, data: dataLines.join("\n") };
}

/** A field's value, without the one optional space after the colon. */
function fieldValue(line: string, field: string): string {
  const value = line.slice(field.length);
  return value.startsWith(" ") ? value.slice(1) : value;
}
