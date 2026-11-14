import { readFileSync } from "node:fs";
import type { InferenceRequest, InferenceStreamEvent } from "../../models/internal-format.js";
import { UpstreamProtocolError } from "../upstream-protocol-converter.js";
import { anthropicMessagesUpstreamConverter } from "./anthropic-messages-upstream-converter.js";

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
  baseUrl: "https://api.anthropic.example/",
  upstreamModelId: "claude-test-5",
  quirks: {},
  maxOutputTokens: 64_000,
};

const CITY_PARAMETERS = { type: "object", properties: { city: { type: "string" } } };

const WEATHER_REQUEST: InferenceRequest = {
  model: "smart",
  system: [{ type: "text", text: "You are terse.", cacheMarker: {} }],
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "What is in this picture, and what is the weather and time there?",
        },
        { type: "image", source: { type: "base64", mediaType: "image/png", data: "iVBORw0KGgo=" } },
        { type: "image", source: { type: "url", url: "https://images.acme.example/paris.jpg" } },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "Need the weather and the time.",
          signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h",
        },
        // Reasoning another Provider produced has no signature; this Protocol would refuse it.
        { type: "reasoning", text: "Thought from an openai-chat Provider." },
        { type: "text", text: "Checking." },
        {
          type: "tool-call",
          id: "toolu_01weather",
          name: "get_weather",
          arguments: '{"city":"Paris"}',
        },
        { type: "tool-call", id: "toolu_02time", name: "get_time", arguments: '{"city":"Paris"}' },
      ],
    },
    {
      role: "tool",
      toolCallId: "toolu_01weather",
      content: [{ type: "text", text: "18°C, cloudy" }],
    },
    { role: "tool", toolCallId: "toolu_02time", content: [{ type: "text", text: "14:00" }] },
    {
      role: "user",
      content: [{ type: "text", text: "Answer as JSON.", cacheMarker: { ttl: "1h" } }],
    },
  ],
  tools: [
    {
      name: "get_weather",
      description: "Current weather for a city",
      parameters: { ...CITY_PARAMETERS, required: ["city"] },
      strict: true,
    },
    { name: "get_time", parameters: CITY_PARAMETERS, cacheMarker: {} },
  ],
  toolChoice: { type: "auto" },
  parallelToolCalls: false,
  responseFormat: {
    type: "json-schema",
    name: "answer",
    schema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
    strict: true,
  },
  reasoning: { effort: "low" },
  maxOutputTokens: 512,
  stopSequences: ["END"],
  stream: { includeUsage: false },
};

const HELLO_REQUEST: InferenceRequest = {
  model: "smart",
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  tools: [],
  stream: null,
};

describe("anthropicMessagesUpstreamConverter", () => {
  it("writes the recorded request to the Provider's messages URL, in a fixed key order", () => {
    const written = anthropicMessagesUpstreamConverter.writeRequest(WEATHER_REQUEST, TARGET);

    expect(written.url).toBe("https://api.anthropic.example/v1/messages");
    expect(written.headers).toEqual({
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    });
    expect(written.body).toBe(JSON.stringify(JSON.parse(fixture("upstream-request.json"))));
  });

  it("writes byte-identical bodies for the same request", () => {
    const first = anthropicMessagesUpstreamConverter.writeRequest(WEATHER_REQUEST, TARGET);
    const second = anthropicMessagesUpstreamConverter.writeRequest(
      structuredClone(WEATHER_REQUEST),
      TARGET,
    );

    expect(second.body).toBe(first.body);
  });

  it("asks for the Upstream Model's max output when the client set no limit", () => {
    const written = anthropicMessagesUpstreamConverter.writeRequest(HELLO_REQUEST, TARGET);

    expect(JSON.parse(written.body).max_tokens).toBe(64_000);
  });

  it("sends a thinking budget as one, without an effort level", () => {
    const written = anthropicMessagesUpstreamConverter.writeRequest(
      { ...HELLO_REQUEST, reasoning: { effort: "high", budgetTokens: 2048 } },
      TARGET,
    );

    const body = JSON.parse(written.body);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(body).not.toHaveProperty("output_config");
  });

  it("parses a recorded response with signed thinking, text, a tool call and cache counts", () => {
    const parsed = anthropicMessagesUpstreamConverter.parseResponse(
      JSON.parse(fixture("upstream-response-tool-call.json")),
    );

    expect(parsed).toEqual({
      content: [
        {
          type: "reasoning",
          text: "The user wants the weather in Paris.",
          signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h",
        },
        { type: "text", text: "Checking the weather." },
        {
          type: "tool-call",
          id: "toolu_01weather",
          name: "get_weather",
          arguments: '{"city":"Paris"}',
        },
      ],
      stopReason: "tool-calls",
      usage: {
        inputTokens: 20,
        outputTokens: 40,
        cacheReadTokens: 100,
        cacheWriteTokens: 30,
        reasoningTokens: null,
      },
    });
  });

  it.each([
    ["end_turn", "end"],
    ["max_tokens", "max-tokens"],
    ["model_context_window_exceeded", "max-tokens"],
    ["stop_sequence", "stop-sequence"],
    ["refusal", "content-filter"],
    ["pause_turn", "end"],
  ])("maps the stop reason %s to %s", (stopReason, expected) => {
    const parsed = anthropicMessagesUpstreamConverter.parseResponse({
      content: [{ type: "text", text: "Hi" }],
      stop_reason: stopReason,
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    expect(parsed.stopReason).toBe(expected);
  });

  it("refuses a body that is not a message", () => {
    expect(() => anthropicMessagesUpstreamConverter.parseResponse({ result: "ok" })).toThrow(
      UpstreamProtocolError,
    );
  });

  it("parses a recorded stream into reasoning, signature, text, tool-call and usage events", async () => {
    const events = await collect(
      anthropicMessagesUpstreamConverter.parseStream(
        bytesOf(fixture("upstream-stream-tool-call.sse")),
      ),
    );

    expect(events).toEqual([
      { type: "reasoning-delta", text: "Paris" },
      { type: "reasoning-delta", text: " weather." },
      { type: "reasoning-signature", signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h" },
      { type: "text-delta", text: "Checking." },
      { type: "tool-call-start", index: 0, id: "toolu_01weather", name: "get_weather" },
      { type: "tool-call-delta", index: 0, argumentsDelta: '{"city":' },
      { type: "tool-call-delta", index: 0, argumentsDelta: '"Paris"}' },
      { type: "finish", stopReason: "tool-calls" },
      {
        type: "usage",
        usage: {
          inputTokens: 20,
          outputTokens: 40,
          cacheReadTokens: 100,
          cacheWriteTokens: 30,
          reasoningTokens: null,
        },
      },
    ]);
  });

  it("fails a stream in which the upstream reports an error", async () => {
    const stream =
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';

    await expect(
      collect(anthropicMessagesUpstreamConverter.parseStream(bytesOf(stream))),
    ).rejects.toThrow(UpstreamProtocolError);
  });

  it("fails a stream that ends before message_stop", async () => {
    const [messageStart] = fixture("upstream-stream-tool-call.sse").split("\n\n");

    await expect(
      collect(anthropicMessagesUpstreamConverter.parseStream(bytesOf(`${messageStart}\n\n`))),
    ).rejects.toThrow(UpstreamProtocolError);
  });
});
