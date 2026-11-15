import type { NestNodeApplication } from "@nestjs/platform-node";
import OpenAI from "openai";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import {
  anthropicMessagesFixture,
  anthropicStreamWithOneThinkingDelta,
  FakeUpstream,
  openAiChatFixture,
  openAiResponsesFixture,
  TWO_THINKING_BLOCKS_STREAM,
  UPSTREAM_ONLY_HEADER,
} from "../support/fake-upstream.js";
import {
  fixtureAsServed,
  insertAnthropicMessagesModel,
  insertApiKey,
  insertOpenAiChatModel,
  UPSTREAM_MODEL_ID,
} from "../support/inference.js";
import { portOf } from "../support/port-of.js";
import { createTestApp } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

/** Served by an openai-chat Provider. */
const CHAT_MODEL = "via-chat";
/** Served by an anthropic-messages Provider. */
const MESSAGES_MODEL = "via-messages";

const SIGNATURE = "EqQBCgIYAhIM1gbcDa9GJwZA2b3h";

const RESPONSE_ID_PREFIX = "resp_";
/** The request id the client fixtures were recorded with. */
const FIXTURE_REQUEST_ID = "ours1";
/** The Model name the client fixtures were recorded with, served by an anthropic-messages Provider. */
const FIXTURE_MODEL = "smart";

/** The settings `client-response.json` echoes. */
const FIXTURE_SETTINGS = {
  tools: [
    {
      type: "function",
      name: "get_weather",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    },
  ],
  tool_choice: { type: "function", name: "get_weather" },
  parallel_tool_calls: false,
  text: { format: { type: "json_schema", name: "weather", schema: { type: "object" } } },
  reasoning: { effort: "low" },
  max_output_tokens: 1024,
  temperature: 0.5,
};

/** The anthropic-messages answer `client-response.json` was recorded from. */
const FIXTURE_UPSTREAM_MESSAGE = {
  id: "msg_upstream_1",
  type: "message",
  role: "assistant",
  model: "claude-test-5",
  content: [
    { type: "thinking", thinking: "Paris weather.", signature: SIGNATURE },
    { type: "text", text: "Checking." },
    { type: "tool_use", id: "call_def456", name: "get_weather", input: { city: "Paris" } },
  ],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: {
    input_tokens: 20,
    cache_creation_input_tokens: 30,
    cache_read_input_tokens: 100,
    output_tokens: 40,
  },
};

const EVERY_FEATURE_REQUEST = {
  instructions: "You are terse.",
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "What is the weather where this was taken?" },
        { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=", detail: "auto" },
      ],
    },
    {
      type: "reasoning",
      id: "rs_earlier",
      summary: [],
      content: [{ type: "reasoning_text", text: "Need the weather." }],
      encrypted_content: SIGNATURE,
    },
    {
      type: "function_call",
      call_id: "toolu_00first",
      name: "get_weather",
      arguments: '{"city":"Paris"}',
    },
    { type: "function_call_output", call_id: "toolu_00first", output: "18°C, cloudy" },
    { role: "user", content: "And tomorrow?" },
  ],
  tools: [
    {
      type: "function",
      name: "get_weather",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    },
  ],
  reasoning: { effort: "low" },
  text: {
    format: {
      type: "json_schema",
      name: "weather",
      schema: { type: "object", additionalProperties: false },
    },
  },
  truncation: "auto",
};

/** One named server-sent event as the gateway wrote it. */
interface NamedEvent {
  event: string;
  data: { type: string; item?: Record<string, unknown>; response?: Record<string, unknown> };
}

function namedEventsOf(text: string): NamedEvent[] {
  return text
    .trim()
    .split("\n\n")
    .map((block) => {
      const [eventLine, dataLine] = block.split("\n");
      return {
        event: eventLine.slice("event: ".length),
        data: JSON.parse(dataLine.slice("data: ".length)),
      };
    });
}

describe("Responses (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    await insertOpenAiChatModel(app, db, { modelName: CHAT_MODEL, baseUrl: upstream.baseUrl });
    await insertAnthropicMessagesModel(app, db, {
      modelName: MESSAGES_MODEL,
      // The Protocol appends /v1/messages to the Provider's base URL.
      baseUrl: new URL(upstream.baseUrl).origin,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  async function insertFixtureModel(): Promise<void> {
    await insertAnthropicMessagesModel(app, db, {
      modelName: FIXTURE_MODEL,
      baseUrl: new URL(upstream.baseUrl).origin,
    });
  }

  function createResponse(body: object) {
    return request(app.getHttpServer())
      .post("/v1/responses")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(body);
  }

  it("serves images, tools, reasoning and a JSON schema from an openai-chat upstream, as our Model", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    const response = await createResponse({ ...EVERY_FEATURE_REQUEST, model: CHAT_MODEL }).expect(
      200,
    );

    expect(upstream.lastRequest.path).toBe("/v1/chat/completions");
    expect(upstream.lastRequest.body).toMatchObject({
      messages: [
        { role: "system", content: "You are terse." },
        { role: "user", content: [{ type: "text" }, { type: "image_url" }] },
        { role: "assistant", tool_calls: [{ id: "toolu_00first" }] },
        { role: "tool", tool_call_id: "toolu_00first" },
        { role: "user" },
      ],
      tools: [{ type: "function", function: { name: "get_weather" } }],
      response_format: { type: "json_schema", json_schema: { name: "weather" } },
      reasoning_effort: "low",
    });
    expect(upstream.lastRequest.body).not.toHaveProperty("truncation");
    expect(response.body).toMatchObject({
      object: "response",
      status: "completed",
      model: CHAT_MODEL,
      store: false,
      output: [
        {
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "The user wants the weather in Paris." }],
        },
        { type: "message", content: [{ type: "output_text", text: "Checking the weather." }] },
        {
          type: "function_call",
          call_id: "call_def456",
          name: "get_weather",
          arguments: '{"city":"Paris"}',
        },
      ],
      // 120 prompt tokens, 100 of them read from the cache.
      usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 100 }, output_tokens: 40 },
    });
    expect(response.body.id).toMatch(/^resp_/);
    expect(response.headers).not.toHaveProperty(UPSTREAM_ONLY_HEADER);
  });

  it("sends the client's signed reasoning back to an anthropic-messages upstream", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(anthropicMessagesFixture("upstream-response-tool-call.json")),
    });

    const response = await createResponse({
      ...EVERY_FEATURE_REQUEST,
      model: MESSAGES_MODEL,
    }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      system: [{ type: "text", text: "You are terse." }],
      messages: [
        { role: "user" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Need the weather.", signature: SIGNATURE },
            { type: "tool_use", id: "toolu_00first" },
          ],
        },
        { role: "user", content: [{ type: "tool_result" }, { type: "text" }] },
      ],
      output_config: { format: { type: "json_schema" } },
    });
    expect(response.body).toMatchObject({
      model: MESSAGES_MODEL,
      output: [
        { type: "reasoning", encrypted_content: SIGNATURE },
        { type: "message" },
        { type: "function_call", call_id: "toolu_01weather" },
      ],
      usage: {
        input_tokens: 150,
        input_tokens_details: { cached_tokens: 100, cache_write_tokens: 30 },
      },
    });
  });

  it("streams an openai-chat upstream's answer as output item events ending with response.completed", async () => {
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });

    const response = await createResponse({
      ...EVERY_FEATURE_REQUEST,
      model: CHAT_MODEL,
      stream: true,
    }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    const events = namedEventsOf(response.text);
    expect(events.map((event) => event.event)).toEqual([
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.reasoning_text.delta",
      "response.reasoning_text.delta",
      "response.reasoning_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.output_item.added",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ]);
    expect(events.at(-1)?.data.response).toMatchObject({
      status: "completed",
      usage: { input_tokens: 120, output_tokens: 40 },
    });
  });

  it("streams an anthropic-messages upstream's answer with the reasoning signature", async () => {
    upstream.reply({
      kind: "stream",
      events: anthropicMessagesFixture("upstream-stream-tool-call.sse"),
    });

    const response = await createResponse({
      ...EVERY_FEATURE_REQUEST,
      model: MESSAGES_MODEL,
      stream: true,
    }).expect(200);

    const events = namedEventsOf(response.text);
    const doneItems = events.flatMap((event) =>
      event.event === "response.output_item.done" && event.data.item ? [event.data.item] : [],
    );
    expect(doneItems[0]).toMatchObject({ type: "reasoning", encrypted_content: SIGNATURE });
    expect(events.at(-1)?.event).toBe("response.completed");
  });

  it("sends a recorded request on, dropping the fields it doesn't know", async () => {
    upstream.reply({
      kind: "stream",
      events: anthropicMessagesFixture("upstream-stream-tool-call.sse"),
    });

    await createResponse({
      ...JSON.parse(openAiResponsesFixture("client-request.json")),
      model: MESSAGES_MODEL,
    }).expect(200);

    // The cache markers are the ones the gateway adds for an anthropic-messages upstream.
    expect(upstream.lastRequest.body).toEqual({
      model: UPSTREAM_MODEL_ID,
      max_tokens: 1024,
      system: [
        { type: "text", text: "You are terse." },
        { type: "text", text: "Answer in JSON.", cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Compare these two pictures." },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
            },
            { type: "image", source: { type: "url", url: "https://images.example/cat.jpg" } },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Look up the weather first.", signature: SIGNATURE },
            { type: "text", text: "Checking." },
            { type: "tool_use", id: "call_weather", name: "get_weather", input: { city: "Paris" } },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_weather",
              content: [{ type: "text", text: "18°C, cloudy" }],
            },
            { type: "text", text: "And tomorrow?", cache_control: { type: "ephemeral" } },
          ],
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Current weather for a city",
          input_schema: { type: "object", properties: { city: { type: "string" } } },
          strict: true,
          cache_control: { type: "ephemeral" },
        },
      ],
      tool_choice: { type: "tool", name: "get_weather", disable_parallel_tool_use: true },
      thinking: { type: "adaptive", display: "summarized" },
      output_config: {
        effort: "xhigh",
        format: { type: "json_schema", schema: { type: "object", additionalProperties: false } },
      },
      temperature: 0.5,
      top_p: 0.9,
      stream: true,
    });
  });

  it.each([
    ["a string input", {}],
    [
      "`store: false` and `previous_response_id: null`",
      { store: false, previous_response_id: null },
    ],
  ])(
    "sends %s on as one stateless user message, without asking for a stream",
    async (_case, fields) => {
      upstream.reply({
        kind: "json",
        status: 200,
        body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
      });

      await createResponse({ model: CHAT_MODEL, input: "Hi", ...fields }).expect(200);

      expect(upstream.lastRequest.body).toEqual({
        model: UPSTREAM_MODEL_ID,
        messages: [{ role: "user", content: "Hi" }],
      });
    },
  );

  it("answers with our own ids and Model name, echoing the request's settings", async () => {
    await insertFixtureModel();
    upstream.reply({ kind: "json", status: 200, body: FIXTURE_UPSTREAM_MESSAGE });

    const response = await createResponse({
      model: FIXTURE_MODEL,
      input: "Hi",
      ...FIXTURE_SETTINGS,
    }).expect(200);

    const served = {
      requestId: response.body.id.slice(RESPONSE_ID_PREFIX.length),
      createdAt: response.body.created_at,
    };
    expect(response.body).toEqual(
      JSON.parse(
        fixtureAsServed(openAiResponsesFixture("client-response.json"), FIXTURE_REQUEST_ID, served),
      ),
    );
  });

  it("answers a response cut off by the token limit as incomplete", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: { ...FIXTURE_UPSTREAM_MESSAGE, stop_reason: "max_tokens" },
    });

    const response = await createResponse({ model: MESSAGES_MODEL, input: "Hi" }).expect(200);

    expect(response.body).toMatchObject({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    });
  });

  it("streams the recorded output item events with their sequence numbers, ending with the whole response", async () => {
    await insertFixtureModel();
    upstream.reply({ kind: "stream", events: anthropicStreamWithOneThinkingDelta() });

    const response = await createResponse({
      model: FIXTURE_MODEL,
      input: "Hi",
      stream: true,
    }).expect(200);

    const created = namedEventsOf(response.text)[0].data.response;
    const served = {
      requestId: String(created?.id).slice(RESPONSE_ID_PREFIX.length),
      createdAt: Number(created?.created_at),
    };
    expect(response.text).toBe(
      fixtureAsServed(openAiResponsesFixture("client-stream.sse"), FIXTURE_REQUEST_ID, served),
    );
  });

  it("ends a stream cut off by the token limit with response.incomplete", async () => {
    upstream.reply({
      kind: "stream",
      events: anthropicMessagesFixture("upstream-stream-tool-call.sse").replace(
        '"stop_reason":"tool_use"',
        '"stop_reason":"max_tokens"',
      ),
    });

    const response = await createResponse({
      model: MESSAGES_MODEL,
      input: "Hi",
      stream: true,
    }).expect(200);

    expect(response.text).toContain("event: response.incomplete\n");
    expect(response.text).toContain('"incomplete_details":{"reason":"max_output_tokens"}');
    expect(response.text).not.toContain("response.completed");
  });

  it("starts a new reasoning item for reasoning that follows a signed one", async () => {
    upstream.reply({ kind: "stream", events: TWO_THINKING_BLOCKS_STREAM });

    const response = await createResponse({
      model: MESSAGES_MODEL,
      input: "Hi",
      stream: true,
    }).expect(200);

    const responseId = String(namedEventsOf(response.text)[0].data.response?.id);
    const requestId = responseId.slice(RESPONSE_ID_PREFIX.length);
    expect(response.text).toContain(
      `"item_id":"rs_${requestId}_1","output_index":1,"content_index":0,"delta":"Second."`,
    );
  });

  it("serves the official OpenAI SDK, streaming and not", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });
    const server = await app.listen(0, "127.0.0.1");
    const client = new OpenAI({
      apiKey,
      baseURL: `http://127.0.0.1:${portOf(server.address())}/v1`,
      maxRetries: 0,
    });
    const params = {
      model: CHAT_MODEL,
      input: "What is the weather in Paris?",
      tools: [
        {
          type: "function" as const,
          name: "get_weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
          strict: false,
        },
      ],
    };

    const created = await client.responses.create(params);
    const streamed = await client.responses.stream(params).finalResponse();

    expect(created.output_text).toBe("Checking the weather.");
    expect(created.output.at(-1)).toMatchObject({
      type: "function_call",
      arguments: '{"city":"Paris"}',
    });
    expect(streamed).toMatchObject({
      model: CHAT_MODEL,
      status: "completed",
      output_text: "Checking.",
      output: [
        { type: "reasoning", content: [{ type: "reasoning_text", text: "Paris weather." }] },
        { type: "message" },
        { type: "function_call", call_id: "call_def456", arguments: '{"city":"Paris"}' },
      ],
      usage: { input_tokens: 120, output_tokens: 40 },
    });
  });

  it("answers 401 invalid_api_key in the OpenAI envelope without a valid key", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/responses")
      .set("Authorization", "Bearer rlm_not-a-real-key")
      .send({ ...EVERY_FEATURE_REQUEST, model: CHAT_MODEL })
      .expect(401);

    expect(response.body).toEqual({
      error: {
        message: expect.any(String),
        type: "invalid_request_error",
        param: null,
        code: "invalid_api_key",
      },
    });
  });

  it("refuses stored responses with 400 naming the feature, without calling the upstream", async () => {
    const response = await createResponse({
      ...EVERY_FEATURE_REQUEST,
      model: CHAT_MODEL,
      store: true,
    }).expect(400);

    expect(response.body.error).toMatchObject({
      type: "invalid_request_error",
      code: "invalid_request",
    });
    expect(response.body.error.message).toContain("`store: true`");
    expect(upstream.requests).toHaveLength(0);
  });

  it("refuses a provider-hosted tool with 400 naming it", async () => {
    const response = await createResponse({
      ...EVERY_FEATURE_REQUEST,
      model: CHAT_MODEL,
      tools: [{ type: "web_search" }],
    }).expect(400);

    expect(response.body.error.message).toContain("`web_search`");
    expect(upstream.requests).toHaveLength(0);
  });

  it.each([
    ["a stored conversation", { conversation: "conv_123" }, "`conversation`"],
    ["a previous response", { previous_response_id: "resp_123" }, "`previous_response_id`"],
    ["background mode", { background: true }, "`background`"],
    ["a stored prompt", { prompt: { id: "pmpt_123" } }, "`prompt`"],
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
  ])("refuses %s with 400 naming it", async (_feature, fields, named) => {
    const response = await createResponse({ model: CHAT_MODEL, input: "Hi", ...fields }).expect(
      400,
    );

    expect(response.body.error.code).toBe("invalid_request");
    expect(response.body.error.message).toContain(named);
    expect(upstream.requests).toHaveLength(0);
  });
});
