type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textValue).join("");
  if (value && typeof value === "object") {
    const item = record(value);
    if (typeof item.text === "string") return item.text;
    if (typeof item.content === "string") return item.content;
  }
  return "";
}

export function streamText(payload: unknown): string {
  const item = record(payload);
  const type = String(item.type || item.event || "").toLowerCase();
  if (
    type === "response.output_text.delta" ||
    type === "response.reasoning_summary_text.delta"
  )
    return textValue(item.delta);

  const delta = record(item.delta);
  const choices = Array.isArray(item.choices) ? record(item.choices[0]) : {};
  const choiceDelta = record(choices.delta);
  if (typeof delta.text === "string") return delta.text;
  if (typeof delta.content === "string") return delta.content;
  if (typeof choiceDelta.content === "string") return choiceDelta.content;
  if (Array.isArray(choiceDelta.content)) return textValue(choiceDelta.content);
  if (type === "content_block_start")
    return textValue(record(item.content_block).text);
  if (type === "content_block_delta") return textValue(delta.text);
  return "";
}

function completedText(payload: unknown): string {
  const item = record(payload);
  if (typeof item.output_text === "string") return item.output_text;
  if (item.content != null) return textValue(item.content);
  const choices = Array.isArray(item.choices) ? record(item.choices[0]) : {};
  const message = record(choices.message);
  if (message.content != null) return textValue(message.content);
  return streamText(payload);
}

function errorText(payload: unknown): string {
  const item = record(payload);
  const error = record(item.error);
  return String(error.message || item.message || "Gateway request failed");
}

export async function readGatewayStream(
  response: Response,
  onText: (text: string) => void,
  onEvent?: (payload: JsonRecord) => void,
): Promise<void> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    try {
      throw new Error(errorText(JSON.parse(body)));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message !== "Unexpected end of JSON input"
      )
        throw error;
      throw new Error(body || `Gateway request failed (${response.status})`);
    }
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const body = await response.text();
    if (!body) return;
    try {
      const payload = record(JSON.parse(body));
      onEvent?.(payload);
      const text = completedText(payload);
      if (text) onText(text);
    } catch {
      onText(body);
    }
    return;
  }

  if (!response.body) {
    const body = await response.text();
    if (!body) return;
    try {
      const payload = record(JSON.parse(body));
      onEvent?.(payload);
      const text = completedText(payload);
      if (text) onText(text);
    } catch {
      onText(body);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeBlock = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return;
    try {
      const payload = record(JSON.parse(data));
      onEvent?.(payload);
      const text = streamText(payload);
      if (text) onText(text);
      const error = record(payload.error);
      if (error.message) throw new Error(String(error.message));
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) consumeBlock(block);
  }

  buffer += decoder.decode();
  if (buffer.trim()) consumeBlock(buffer);
}
