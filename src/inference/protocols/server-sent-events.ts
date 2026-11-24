export interface ServerSentEvent {
  event: string | undefined;
  data: string;
}

const EVENT_SEPARATOR = /\r?\n\r?\n/;
const LINE_SEPARATOR = /\r?\n/;

export class ServerSentEventDecoder {
  private readonly decoder = new TextDecoder();
  private buffered = "";

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
  }
  if (dataLines.length === 0) {
    return null;
  }
  return { event, data: dataLines.join("\n") };
}

function fieldValue(line: string, field: string): string {
  const value = line.slice(field.length);
  return value.startsWith(" ") ? value.slice(1) : value;
}
