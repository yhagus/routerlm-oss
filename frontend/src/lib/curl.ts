type JsonRecord = Record<string, unknown>;

export interface ParsedCurl {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface StreamDelta {
  text: string;
  reasoning: string;
}

export function buildChatCurl(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt = "Hello",
): string {
  const body = JSON.stringify(
    {
      model,
      stream: true,
      messages: [{ role: "user", content: prompt }],
    },
    null,
    2,
  );
  return [
    `curl ${baseUrl}/chat/completions \\`,
    `  -H "Authorization: Bearer ${apiKey || "YOUR_API_KEY"}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${body.replace(/'/g, `'\\''`)}'`,
  ].join("\n");
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let active = false;
  let quote: "'" | '"' | "" = "";
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote === "'") {
      if (char === "'") quote = "";
      else current += char;
    } else if (quote === '"') {
      if (char === '"') quote = "";
      else if (char === "\\" && i + 1 < input.length) {
        i += 1;
        current += input[i];
      } else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      active = true;
    } else if (char === "\\" && /\r?\n/.test(input.slice(i + 1, i + 3))) {
      i += input[i + 1] === "\r" ? 2 : 1;
    } else if (/\s/.test(char)) {
      if (active || current) tokens.push(current);
      current = "";
      active = false;
    } else {
      current += char;
      active = true;
    }
  }
  if (quote) throw new Error("Unclosed quote in curl command.");
  if (active || current) tokens.push(current);
  return tokens;
}

const BODY_FLAGS = new Set([
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-ascii",
]);

export function parseCurl(input: string): ParsedCurl {
  const tokens = tokenize(input.trim());
  if (tokens[0] !== "curl") throw new Error("Command must start with curl.");
  const headers: Record<string, string> = {};
  let url = "";
  let method = "";
  let body: string | undefined;
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "-H" || token === "--header") {
      const header = tokens[(i += 1)] || "";
      const index = header.indexOf(":");
      if (index > 0)
        headers[header.slice(0, index).trim()] = header.slice(index + 1).trim();
    } else if (BODY_FLAGS.has(token)) {
      body = tokens[(i += 1)] ?? "";
    } else if (token === "-X" || token === "--request") {
      method = (tokens[(i += 1)] || "").toUpperCase();
    } else if (token.startsWith("-")) {
      continue;
    } else if (!url) {
      url = token;
    }
  }
  if (!url) throw new Error("The curl command has no URL.");
  return {
    url,
    method: method || (body !== undefined ? "POST" : "GET"),
    headers,
    body,
  };
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function blocksText(content: unknown, type: string, key: string): string {
  if (!Array.isArray(content)) return "";
  return content
    .map(record)
    .filter((block) => block.type === type)
    .map((block) => str(block[key]))
    .join("");
}

/** Reads answer text and reasoning from one OpenAI, Anthropic, or Responses payload. */
export function extractDelta(payload: unknown): StreamDelta {
  const item = record(payload);
  const type = str(item.type);
  const out: StreamDelta = { text: "", reasoning: "" };

  if (type === "response.output_text.delta") out.text = str(item.delta);
  else if (
    type === "response.reasoning_summary_text.delta" ||
    type === "response.reasoning_text.delta"
  )
    out.reasoning = str(item.delta);
  else if (type === "content_block_delta") {
    const delta = record(item.delta);
    out.text = str(delta.text);
    out.reasoning = str(delta.thinking);
  } else if (type === "content_block_start") {
    const block = record(item.content_block);
    out.text = str(block.text);
    out.reasoning = str(block.thinking);
  }
  if (out.text || out.reasoning) return out;

  const choice = record(Array.isArray(item.choices) ? item.choices[0] : {});
  const delta = record(choice.delta);
  const message = record(choice.message);
  const source = Object.keys(delta).length ? delta : message;
  out.text = str(source.content) || blocksText(source.content, "text", "text");
  out.reasoning = str(source.reasoning_content) || str(source.reasoning);
  if (out.text || out.reasoning) return out;

  if (type === "message" || Array.isArray(item.content)) {
    out.text = blocksText(item.content, "text", "text");
    out.reasoning = blocksText(item.content, "thinking", "thinking");
  }
  return out;
}
