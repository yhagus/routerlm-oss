/** One server-sent event: its `event:` name, if any, and its `data:` lines joined. */
export interface ServerSentEvent {
  event: string | undefined;
  data: string;
}

const EVENT_SEPARATOR = /\r?\n\r?\n/;
const LINE_SEPARATOR = /\r?\n/;

/**
 * Splits a server-sent-event byte stream into events as its bytes arrive,
 * without awaiting anything: the relay loop pushes each network read and
 * gets back every event it completed.
 */
export class ServerSentEventDecoder {
  private readonly decoder = new TextDecoder();
  private buffered = "";

  /** The events this read completed, in order; often none, sometimes several. */
  push(chunk: Uint8Array): ServerSentEvent[] {
    this.buffered += this.decoder.decode(chunk, { stream: true });
    const blocks = this.buffered.split(EVENT_SEPARATOR);
    this.buffered = blocks.pop() ?? "";
    const events: ServerSentEvent[] = [];
    for (const block of blocks) {
      const event = parseEventBlock(block);
      if (event) {
        events.push(event);
      }
    }
    return events;
  }

  /** The last event, when the body ended without a blank line after it. */
  end(): ServerSentEvent[] {
    const last = parseEventBlock(this.buffered + this.decoder.decode());
    this.buffered = "";
    return last ? [last] : [];
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
