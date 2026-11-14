import { readFileSync } from "node:fs";
import { GatewayError } from "../../gateway-error.js";
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from "../../internal-format.js";
import { writeClientStream } from "../client-protocol-converter.js";
import { openAiResponsesClientConverter } from "./openai-responses-client-converter.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function parseFailure(body: unknown): GatewayError {
  try {
    openAiResponsesClientConverter.parseRequest(body);
  } catch (error) {
    if (error instanceof GatewayError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the request to be refused");
}

const MINIMAL_REQUEST = { model: "smart", input: "Hi" };

const PARSED_MINIMAL_REQUEST: InferenceRequest = {
  model: "smart",
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  tools: [],
  stream: null,
};

const STREAMING_REQUEST: InferenceRequest = {
  ...PARSED_MINIMAL_REQUEST,
  stream: { includeUsage: true },
};

const CONTEXT = {
  requestId: "ours1",
  modelName: "smart",
  createdAt: new Date(1_794_700_000_000),
};

const USAGE = {
  inputTokens: 20,
  outputTokens: 40,
  cacheReadTokens: 100,
  cacheWriteTokens: 30,
  reasoningTokens: 12,
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

describe("openAiResponsesClientConverter", () => {
  it("parses a recorded request into the internal format, dropping unknown fields", () => {
    const parsed = openAiResponsesClientConverter.parseRequest(
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
            {
              type: "reasoning",
              text: "Look up the weather first.",
              signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h",
            },
            { type: "text", text: "Checking." },
            {
              type: "tool-call",
              id: "call_weather",
              name: "get_weather",
              arguments: '{"city":"Paris"}',
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "call_weather",
          content: [{ type: "text", text: "18°C, cloudy" }],
        },
        { role: "user", content: [{ type: "text", text: "And tomorrow?" }] },
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
        name: "weather",
        schema: { type: "object", additionalProperties: false },
        strict: true,
      },
      reasoning: { effort: "xhigh" },
      maxOutputTokens: 1024,
      temperature: 0.5,
      topP: 0.9,
      stream: { includeUsage: true },
    } satisfies InferenceRequest);
  });

  it("parses a string input as one user message, non-streaming", () => {
    expect(openAiResponsesClientConverter.parseRequest(MINIMAL_REQUEST)).toEqual(
      PARSED_MINIMAL_REQUEST,
    );
  });

  it("treats `store: false` and `previous_response_id: null` as stateless", () => {
    expect(
      openAiResponsesClientConverter.parseRequest({
        ...MINIMAL_REQUEST,
        store: false,
        previous_response_id: null,
      }),
    ).toEqual(PARSED_MINIMAL_REQUEST);
  });

  it.each([
    ["stored responses", { store: true }, "`store: true`"],
    ["a previous response", { previous_response_id: "resp_123" }, "`previous_response_id`"],
    ["a stored conversation", { conversation: "conv_123" }, "`conversation`"],
    ["background mode", { background: true }, "`background`"],
    ["a stored prompt", { prompt: { id: "pmpt_123" } }, "`prompt`"],
    ["a provider-hosted tool", { tools: [{ type: "web_search" }] }, "`web_search`"],
    [
      "a reference to a stored item",
      { input: [{ type: "item_reference", id: "msg_123" }] },
      "`item_reference`",
    ],
    [
      "file input",
      { input: [{ role: "user", content: [{ type: "input_file", file_id: "file-123" }] }] },
      "`input_file`",
    ],
    [
      "an image by file id",
      { input: [{ role: "user", content: [{ type: "input_image", file_id: "file-123" }] }] },
      "`file_id`",
    ],
  ])("refuses %s with a 400 naming it", (_feature, fields, named) => {
    const error = parseFailure({ ...MINIMAL_REQUEST, ...fields });

    expect(error.code).toBe("invalid_request");
    expect(error.message).toContain(named);
  });

  it("writes a response with our ids and Model name, echoing the request's settings", () => {
    const request: InferenceRequest = {
      ...PARSED_MINIMAL_REQUEST,
      tools: [
        {
          name: "get_weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
      toolChoice: { type: "tool", name: "get_weather" },
      parallelToolCalls: false,
      responseFormat: { type: "json-schema", name: "weather", schema: { type: "object" } },
      reasoning: { effort: "low" },
      maxOutputTokens: 1024,
      temperature: 0.5,
    };
    const response: InferenceResponse = {
      content: [
        { type: "reasoning", text: "Paris weather.", signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h" },
        { type: "text", text: "Checking." },
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

    const written = openAiResponsesClientConverter.writeResponse(response, request, CONTEXT);

    expect(written).toEqual(JSON.parse(fixture("client-response.json")));
  });

  it("writes a response cut off by the token limit as incomplete", () => {
    const response: InferenceResponse = {
      content: [{ type: "text", text: "Once upon" }],
      stopReason: "max-tokens",
      usage: USAGE,
    };

    const written = openAiResponsesClientConverter.writeResponse(
      response,
      PARSED_MINIMAL_REQUEST,
      CONTEXT,
    );

    expect(written).toMatchObject({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    });
  });

  it("streams output items with numbered events, ending with the whole response", async () => {
    const events = eventsOf(
      { type: "reasoning-delta", text: "Paris" },
      { type: "reasoning-signature", signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h" },
      { type: "text-delta", text: "Checking." },
      { type: "tool-call-start", index: 0, id: "call_def456", name: "get_weather" },
      { type: "tool-call-delta", index: 0, argumentsDelta: '{"city":' },
      { type: "tool-call-delta", index: 0, argumentsDelta: '"Paris"}' },
      { type: "finish", stopReason: "tool-calls" },
      { type: "usage", usage: USAGE },
    );

    const written = await textOf(
      openAiResponsesClientConverter.writeStream(events, STREAMING_REQUEST, CONTEXT),
    );

    expect(written).toBe(fixture("client-stream.sse"));
  });

  it("ends a stream cut off by the token limit with response.incomplete", async () => {
    const events = eventsOf(
      { type: "text-delta", text: "Once upon" },
      { type: "usage", usage: USAGE },
      { type: "finish", stopReason: "max-tokens" },
    );

    const written = await textOf(
      openAiResponsesClientConverter.writeStream(events, STREAMING_REQUEST, CONTEXT),
    );

    expect(written).toContain("event: response.incomplete\n");
    expect(written).toContain('"incomplete_details":{"reason":"max_output_tokens"}');
    expect(written).not.toContain("response.completed");
  });

  it("starts a new reasoning item for reasoning that follows a signed one", async () => {
    const events = eventsOf(
      { type: "reasoning-delta", text: "First." },
      { type: "reasoning-signature", signature: "sig-1" },
      { type: "reasoning-delta", text: "Second." },
      { type: "finish", stopReason: "end" },
    );

    const written = await textOf(
      openAiResponsesClientConverter.writeStream(events, STREAMING_REQUEST, CONTEXT),
    );

    expect(written).toContain(
      '"item_id":"rs_ours1_1","output_index":1,"content_index":0,"delta":"Second."',
    );
  });

  it("ends a stream that fails midway with an error event and no response.completed", async () => {
    async function* failing(): AsyncIterable<InferenceStreamEvent> {
      yield { type: "text-delta", text: "Hel" };
      throw new GatewayError("upstream_error", "The upstream stream broke off");
    }

    const written = await textOf(
      writeClientStream(openAiResponsesClientConverter, failing(), STREAMING_REQUEST, CONTEXT),
    );

    expect(written).toContain('"delta":"Hel"');
    expect(
      written.endsWith(
        'event: error\ndata: {"type":"error","code":"upstream_error","message":"The upstream stream broke off","param":null}\n\n',
      ),
    ).toBe(true);
    expect(written).not.toContain("response.completed");
  });

  it("writes errors in the OpenAI envelope with the gateway's code", () => {
    const written = openAiResponsesClientConverter.writeError(
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
