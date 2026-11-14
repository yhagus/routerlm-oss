import { readFileSync } from "node:fs";
import { writeClientStream } from "../client-protocol-converter.js";
import { parseFailureOf } from "../../../../test/support/parse-failure.js";
import { GatewayError } from "../../gateway-error.js";
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from "../../internal-format.js";
import { anthropicMessagesClientConverter } from "./anthropic-messages-client-converter.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function parseFailure(body: unknown): GatewayError {
  return parseFailureOf(anthropicMessagesClientConverter, body);
}

const MINIMAL_REQUEST = {
  model: "smart",
  max_tokens: 256,
  messages: [{ role: "user", content: "Hi" }],
};

const PARSED_MINIMAL_REQUEST: InferenceRequest = {
  model: "smart",
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  tools: [],
  maxOutputTokens: 256,
  stream: null,
};

const STREAMING_REQUEST: InferenceRequest = {
  ...PARSED_MINIMAL_REQUEST,
  stream: { includeUsage: true },
};

const CONTEXT = {
  requestId: "ours-1",
  modelName: "smart",
  createdAt: new Date(1_794_700_000_000),
};

const USAGE = {
  inputTokens: 20,
  outputTokens: 40,
  cacheReadTokens: 100,
  cacheWriteTokens: 30,
  reasoningTokens: null,
};

async function* eventsOf(...events: InferenceStreamEvent[]): AsyncIterable<InferenceStreamEvent> {
  yield* events;
}

async function textOf(chunks: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const chunk of chunks) {
    text += chunk;
  }
  return text;
}

describe("anthropicMessagesClientConverter", () => {
  it("parses a recorded request into the internal format, keeping cache markers and dropping unknown fields", () => {
    const parsed = anthropicMessagesClientConverter.parseRequest(
      JSON.parse(fixture("client-request.json")),
    );

    expect(parsed).toEqual({
      model: "smart",
      system: [
        { type: "text", text: "You are terse." },
        { type: "text", text: "Answer in JSON.", cacheMarker: {} },
      ],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Compare these two pictures." },
            {
              type: "image",
              source: { type: "base64", mediaType: "image/png", data: "iVBORw0KGgo=" },
            },
            {
              type: "image",
              source: { type: "url", url: "https://images.example/cat.jpg" },
              cacheMarker: { ttl: "1h" },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "Look up the weather first.",
              signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h",
            },
            { type: "text", text: "Checking." },
            {
              type: "tool-call",
              id: "toolu_01weather",
              name: "get_weather",
              arguments: '{"city":"Paris"}',
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "toolu_01weather",
          content: [{ type: "text", text: "18°C, cloudy", cacheMarker: {} }],
        },
        { role: "user", content: [{ type: "text", text: "And tomorrow?" }] },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Current weather for a city",
          parameters: { type: "object", properties: { city: { type: "string" } } },
          strict: true,
          cacheMarker: {},
        },
      ],
      toolChoice: { type: "tool", name: "get_weather" },
      parallelToolCalls: false,
      responseFormat: { type: "json-schema", name: "response", schema: { type: "object" } },
      reasoning: { effort: "low" },
      maxOutputTokens: 1024,
      temperature: 0.5,
      topP: 0.9,
      stopSequences: ["END"],
      stream: { includeUsage: true },
    } satisfies InferenceRequest);
  });

  it("parses a minimal request as non-streaming", () => {
    expect(anthropicMessagesClientConverter.parseRequest(MINIMAL_REQUEST)).toEqual(
      PARSED_MINIMAL_REQUEST,
    );
  });

  it("parses a fixed thinking budget, and disabled thinking as no reasoning effort", () => {
    const budgeted = anthropicMessagesClientConverter.parseRequest({
      ...MINIMAL_REQUEST,
      thinking: { type: "enabled", budget_tokens: 2048 },
    });
    const disabled = anthropicMessagesClientConverter.parseRequest({
      ...MINIMAL_REQUEST,
      thinking: { type: "disabled" },
    });

    expect(budgeted.reasoning).toEqual({ budgetTokens: 2048 });
    expect(disabled.reasoning).toEqual({ effort: "none" });
  });

  it("marks the last block of the conversation when the client asks for automatic caching", () => {
    const parsed = anthropicMessagesClientConverter.parseRequest({
      ...MINIMAL_REQUEST,
      cache_control: { type: "ephemeral" },
    });

    expect(parsed.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Hi", cacheMarker: {} }] },
    ]);
  });

  it("refuses server tools, naming the tool type", () => {
    const refused = parseFailure({
      ...MINIMAL_REQUEST,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
    });

    expect(refused.code).toBe("invalid_request");
    expect(refused.message).toContain("web_search_20260209");
  });

  it("refuses document input, naming the content block", () => {
    const refused = parseFailure({
      ...MINIMAL_REQUEST,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
            },
          ],
        },
      ],
    });

    expect(refused.code).toBe("invalid_request");
    expect(refused.message).toContain("document");
  });

  it("refuses a body without max_tokens", () => {
    expect(parseFailure({ model: "smart", messages: MINIMAL_REQUEST.messages }).code).toBe(
      "invalid_request",
    );
  });

  it("writes a response with our id and Model name", () => {
    const response: InferenceResponse = {
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
      usage: USAGE,
    };

    const written = anthropicMessagesClientConverter.writeResponse(
      response,
      PARSED_MINIMAL_REQUEST,
      CONTEXT,
    );

    expect(written).toEqual(JSON.parse(fixture("client-response.json")));
  });

  it("writes unsigned reasoning with an empty signature, which is dropped when sent back", () => {
    const written = anthropicMessagesClientConverter.writeResponse(
      { content: [{ type: "reasoning", text: "Hmm." }], stopReason: "end", usage: USAGE },
      PARSED_MINIMAL_REQUEST,
      CONTEXT,
    );
    const sentBack = anthropicMessagesClientConverter.parseRequest({
      ...MINIMAL_REQUEST,
      messages: [
        ...MINIMAL_REQUEST.messages,
        { role: "assistant", content: [{ type: "thinking", thinking: "Hmm.", signature: "" }] },
      ],
    });

    expect(written).toMatchObject({
      content: [{ type: "thinking", thinking: "Hmm.", signature: "" }],
    });
    expect(sentBack.messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "reasoning", text: "Hmm." }],
    });
  });

  it("writes a stream as named events, with the stop reason and usage at the end", async () => {
    const events = eventsOf(
      { type: "reasoning-delta", text: "Paris" },
      { type: "reasoning-signature", signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h" },
      { type: "text-delta", text: "Checking." },
      { type: "tool-call-start", index: 0, id: "toolu_01weather", name: "get_weather" },
      { type: "tool-call-delta", index: 0, argumentsDelta: '{"city":' },
      { type: "tool-call-delta", index: 0, argumentsDelta: '"Paris"}' },
      { type: "finish", stopReason: "tool-calls" },
      { type: "usage", usage: USAGE },
    );

    const written = await textOf(
      anthropicMessagesClientConverter.writeStream(events, STREAMING_REQUEST, CONTEXT),
    );

    expect(written).toBe(fixture("client-stream.sse"));
  });

  it("starts a new thinking block for reasoning that follows a signed one", async () => {
    const events = eventsOf(
      { type: "reasoning-delta", text: "First." },
      { type: "reasoning-signature", signature: "sig-1" },
      { type: "reasoning-delta", text: "Second." },
      { type: "finish", stopReason: "end" },
    );

    const written = await textOf(
      anthropicMessagesClientConverter.writeStream(events, STREAMING_REQUEST, CONTEXT),
    );

    expect(written).toContain(
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"Second."}}',
    );
  });

  it("ends a stream that fails midway with an error event and no message_stop", async () => {
    async function* failing(): AsyncIterable<InferenceStreamEvent> {
      yield { type: "text-delta", text: "Hel" };
      throw new GatewayError("upstream_error", "The upstream stream broke off");
    }

    const written = await textOf(
      writeClientStream(anthropicMessagesClientConverter, failing(), STREAMING_REQUEST, CONTEXT),
    );

    expect(written).toContain('"text":"Hel"');
    expect(
      written.endsWith(
        'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"The upstream stream broke off","code":"upstream_error"}}\n\n',
      ),
    ).toBe(true);
    expect(written).not.toContain("message_stop");
  });

  it("writes errors in the Anthropic envelope with the gateway's code", () => {
    const written = anthropicMessagesClientConverter.writeError(
      new GatewayError("model_not_found", 'The Model "nope" does not exist'),
    );

    expect(written).toEqual({
      type: "error",
      error: {
        type: "not_found_error",
        message: 'The Model "nope" does not exist',
        code: "model_not_found",
      },
    });
  });
});
