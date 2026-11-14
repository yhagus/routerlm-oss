import { readFileSync } from "node:fs";
import { GatewayError } from "../../gateway-error.js";
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from "../../internal-format.js";
import { writeClientStream } from "../client-protocol-converter.js";
import { openAiChatClientConverter } from "./openai-chat-client-converter.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

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

function parseFailure(body: unknown): GatewayError {
  try {
    openAiChatClientConverter.parseRequest(body);
  } catch (error) {
    if (error instanceof GatewayError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the request to be refused");
}

const CONTEXT = {
  requestId: "ours-1",
  modelName: "smart",
  createdAt: new Date(1_794_700_000_000),
};

const MINIMAL_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };

const PARSED_MINIMAL_REQUEST: InferenceRequest = {
  model: "smart",
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  tools: [],
  stream: null,
};

const USAGE = {
  inputTokens: 20,
  outputTokens: 40,
  cacheReadTokens: 100,
  cacheWriteTokens: 0,
  reasoningTokens: 12,
};

describe("openAiChatClientConverter", () => {
  it("parses a recorded request into the internal format, dropping unknown fields", () => {
    const parsed = openAiChatClientConverter.parseRequest(
      JSON.parse(fixture("client-request.json")),
    );

    expect(parsed).toEqual({
      model: "smart",
      system: [
        { type: "text", text: "You are terse." },
        { type: "text", text: "Answer in JSON." },
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
            { type: "image", source: { type: "url", url: "https://images.example/cat.jpg" } },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Look up the weather first." },
            {
              type: "tool-call",
              id: "call_abc123",
              name: "get_weather",
              arguments: '{"city":"Paris"}',
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "call_abc123",
          content: [{ type: "text", text: "18°C, cloudy" }],
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Current weather for a city",
          parameters: { type: "object", properties: { city: { type: "string" } } },
          strict: true,
        },
      ],
      toolChoice: { type: "tool", name: "get_weather" },
      parallelToolCalls: false,
      responseFormat: {
        type: "json-schema",
        name: "answer",
        schema: { type: "object" },
        strict: true,
      },
      reasoning: { effort: "high" },
      maxOutputTokens: 1024,
      temperature: 0.5,
      topP: 0.9,
      stopSequences: ["END"],
      stream: { includeUsage: true },
    } satisfies InferenceRequest);
  });

  it("parses a minimal request as non-streaming", () => {
    expect(openAiChatClientConverter.parseRequest(MINIMAL_REQUEST)).toEqual(PARSED_MINIMAL_REQUEST);
  });

  it("refuses more than one choice, naming the field", () => {
    const refused = parseFailure({ ...MINIMAL_REQUEST, n: 2 });

    expect(refused.code).toBe("invalid_request");
    expect(refused.message).toContain("`n`");
  });

  it("refuses audio input, naming the content part", () => {
    const refused = parseFailure({
      model: "smart",
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: "AAA", format: "wav" } }],
        },
      ],
    });

    expect(refused.code).toBe("invalid_request");
    expect(refused.message).toContain("input_audio");
  });

  it("refuses a body without messages", () => {
    expect(parseFailure({ model: "smart" }).code).toBe("invalid_request");
  });

  it("writes a response with our id and Model name", () => {
    const response: InferenceResponse = {
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
      usage: USAGE,
    };

    const written = openAiChatClientConverter.writeResponse(
      response,
      PARSED_MINIMAL_REQUEST,
      CONTEXT,
    );

    expect(written).toEqual(JSON.parse(fixture("client-response.json")));
  });

  it("writes a stream with usage when the client asked for it, ending with [DONE]", async () => {
    const request = { ...PARSED_MINIMAL_REQUEST, stream: { includeUsage: true } };
    const events = eventsOf(
      { type: "usage", usage: USAGE },
      { type: "reasoning-delta", text: "Paris" },
      { type: "text-delta", text: "Checking." },
      { type: "tool-call-start", index: 0, id: "call_def456", name: "get_weather" },
      { type: "tool-call-delta", index: 0, argumentsDelta: '{"city":"Paris"}' },
      { type: "finish", stopReason: "tool-calls" },
    );

    const written = await textOf(openAiChatClientConverter.writeStream(events, request, CONTEXT));

    expect(written).toBe(fixture("client-stream.sse"));
  });

  it("ends a stream that fails midway with an error event and no [DONE]", async () => {
    async function* failing(): AsyncIterable<InferenceStreamEvent> {
      yield { type: "text-delta", text: "Hel" };
      throw new GatewayError("upstream_error", "The upstream stream broke off");
    }
    const request = { ...PARSED_MINIMAL_REQUEST, stream: { includeUsage: false } };

    const written = await textOf(
      writeClientStream(openAiChatClientConverter, failing(), request, CONTEXT),
    );

    expect(written).toContain('"content":"Hel"');
    expect(
      written.endsWith(
        'data: {"error":{"message":"The upstream stream broke off","type":"server_error","param":null,"code":"upstream_error"}}\n\n',
      ),
    ).toBe(true);
    expect(written).not.toContain("[DONE]");
  });

  it("writes errors in the OpenAI envelope with the gateway's code", () => {
    const written = openAiChatClientConverter.writeError(
      new GatewayError("model_not_found", 'The Model "nope" does not exist'),
    );

    expect(written).toEqual({
      error: {
        message: 'The Model "nope" does not exist',
        type: "invalid_request_error",
        param: null,
        code: "model_not_found",
      },
    });
  });
});
