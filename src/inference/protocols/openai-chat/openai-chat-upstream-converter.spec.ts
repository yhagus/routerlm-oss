import { readFileSync } from "node:fs";
import type { InferenceRequest, InferenceStreamEvent } from "../../internal-format.js";
import { UpstreamProtocolError } from "../upstream-protocol-converter.js";
import { openAiChatUpstreamConverter } from "./openai-chat-upstream-converter.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

async function* bytesOf(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function collect(
  events: AsyncIterable<InferenceStreamEvent>,
): Promise<InferenceStreamEvent[]> {
  const collected: InferenceStreamEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

const TARGET = {
  baseUrl: "https://api.acme.example/v1",
  upstreamModelId: "acme-large-2026",
  quirks: {},
};

const WEATHER_REQUEST: InferenceRequest = {
  model: "smart",
  system: [{ type: "text", text: "You are terse." }],
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What is in this picture, and what is the weather there?" },
        { type: "image", source: { type: "base64", mediaType: "image/png", data: "iVBORw0KGgo=" } },
      ],
    },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "Need the weather." },
        {
          type: "tool-call",
          id: "call_abc123",
          name: "get_weather",
          arguments: '{"city":"Paris"}',
        },
      ],
    },
    { role: "tool", toolCallId: "call_abc123", content: [{ type: "text", text: "18°C, cloudy" }] },
  ],
  tools: [
    {
      name: "get_weather",
      description: "Current weather for a city",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  ],
  toolChoice: { type: "auto" },
  responseFormat: {
    type: "json-schema",
    name: "answer",
    schema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    },
    strict: true,
  },
  reasoning: { effort: "low" },
  maxOutputTokens: 512,
  temperature: 0.2,
  stream: { includeUsage: false },
};

describe("openAiChatUpstreamConverter", () => {
  it("writes the recorded request to the Provider's chat completions URL, always asking a stream for usage", () => {
    const written = openAiChatUpstreamConverter.writeRequest(WEATHER_REQUEST, TARGET);

    expect(written.url).toBe("https://api.acme.example/v1/chat/completions");
    expect(written.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(written.body)).toEqual(JSON.parse(fixture("upstream-request.json")));
  });

  it("writes byte-identical bodies for the same request", () => {
    const first = openAiChatUpstreamConverter.writeRequest(WEATHER_REQUEST, TARGET);
    const second = openAiChatUpstreamConverter.writeRequest(
      structuredClone(WEATHER_REQUEST),
      TARGET,
    );

    expect(second.body).toBe(first.body);
  });

  it("sends reasoning back on tool-call turns when the Provider requires it", () => {
    const written = openAiChatUpstreamConverter.writeRequest(WEATHER_REQUEST, {
      ...TARGET,
      quirks: { reasoningContentInHistory: "tool-call-turns" },
    });

    const assistantTurn = JSON.parse(written.body).messages[2];
    expect(assistantTurn.reasoning_content).toBe("Need the weather.");
  });

  it("parses a recorded response with reasoning, text, a tool call and cached tokens", () => {
    const parsed = openAiChatUpstreamConverter.parseResponse(
      JSON.parse(fixture("upstream-response-tool-call.json")),
    );

    expect(parsed).toEqual({
      content: [
        { type: "reasoning", text: "The user wants the weather in Paris." },
        { type: "text", text: "Checking the weather." },
        {
          type: "tool-call",
          id: "call_def456",
          name: "get_weather",
          arguments: '{"city":"Paris"}',
        },
      ],
      stopReason: "tool-calls",
      usage: {
        inputTokens: 20,
        outputTokens: 40,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
        reasoningTokens: 12,
      },
    });
  });

  it("refuses a body that is not a chat completion", () => {
    expect(() => openAiChatUpstreamConverter.parseResponse({ result: "ok" })).toThrow(
      UpstreamProtocolError,
    );
  });

  it("parses a recorded stream into reasoning, text, tool-call and usage events", async () => {
    const events = await collect(
      openAiChatUpstreamConverter.parseStream(bytesOf(fixture("upstream-stream-tool-call.sse"))),
    );

    expect(events).toEqual([
      { type: "reasoning-delta", text: "Paris" },
      { type: "reasoning-delta", text: " weather." },
      { type: "text-delta", text: "Checking." },
      { type: "tool-call-start", index: 0, id: "call_def456", name: "get_weather" },
      { type: "tool-call-delta", index: 0, argumentsDelta: '{"city":' },
      { type: "tool-call-delta", index: 0, argumentsDelta: '"Paris"}' },
      { type: "finish", stopReason: "tool-calls" },
      {
        type: "usage",
        usage: {
          inputTokens: 20,
          outputTokens: 40,
          cacheReadTokens: 100,
          cacheWriteTokens: 0,
          reasoningTokens: 12,
        },
      },
    ]);
  });

  it("fails a stream in which the upstream reports an error", async () => {
    const stream = 'data: {"error":{"message":"overloaded","type":"server_error"}}\n\n';

    await expect(collect(openAiChatUpstreamConverter.parseStream(bytesOf(stream)))).rejects.toThrow(
      UpstreamProtocolError,
    );
  });
});
