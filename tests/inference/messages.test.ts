import Anthropic from "@anthropic-ai/sdk";
import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import {
  anthropicMessagesFixture,
  anthropicStreamWithOneThinkingDelta,
  FakeUpstream,
  openAiChatFixture,
  TWO_THINKING_BLOCKS_STREAM,
  UPSTREAM_ONLY_HEADER,
} from "@tests/support/fake-upstream.js";
import {
  fixtureAsServed,
  insertAnthropicMessagesModel,
  insertApiKey,
  insertOpenAiChatModel,
  setProviderQuirks,
  UPSTREAM_MODEL_ID,
} from "@tests/support/inference.js";
import { portOf } from "@tests/support/port-of.js";
import { createTestApp } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

/** Served by an openai-chat Provider. */
const CHAT_MODEL = "via-chat";
/** Served by an anthropic-messages Provider. */
const MESSAGES_MODEL = "via-messages";

const EVERY_FEATURE_REQUEST = {
  max_tokens: 1024,
  system: [{ type: "text", text: "You are terse.", cache_control: { type: "ephemeral" } }],
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What is the weather where this was taken?" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "Need the weather.",
          signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h",
        },
        { type: "tool_use", id: "toolu_00first", name: "get_weather", input: { city: "Paris" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_00first", content: "18°C, cloudy" },
        { type: "text", text: "And tomorrow?" },
      ],
    },
  ],
  tools: [
    {
      name: "get_weather",
      input_schema: { type: "object", properties: { city: { type: "string" } } },
    },
  ],
  thinking: { type: "adaptive" },
  output_config: {
    effort: "low",
    format: { type: "json_schema", schema: { type: "object", additionalProperties: false } },
  },
  top_k: 5,
};

const MESSAGE_ID_PREFIX = "msg_";
/** The request id the client fixtures were recorded with. */
const FIXTURE_REQUEST_ID = "ours-1";
const MINIMAL_REQUEST = { max_tokens: 256, messages: [{ role: "user", content: "Hi" }] };

/** The Model name the client fixtures were recorded with, served by an anthropic-messages Provider. */
const FIXTURE_MODEL = "smart";

/** One named server-sent event as the gateway wrote it. */
interface NamedEvent {
  event: string;
  data: { type: string; delta?: Record<string, unknown>; message?: { id: string } };
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

describe("Messages (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let chatProviderId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    ({ providerId: chatProviderId } = await insertOpenAiChatModel(app, db, {
      modelName: CHAT_MODEL,
      baseUrl: upstream.baseUrl,
    }));
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

  function createMessage(body: object) {
    return request(app.getHttpServer()).post("/v1/messages").set("x-api-key", apiKey).send(body);
  }

  it("serves images, tools, reasoning and a JSON schema from an openai-chat upstream, as our Model", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    const response = await createMessage({ ...EVERY_FEATURE_REQUEST, model: CHAT_MODEL }).expect(
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
      response_format: { type: "json_schema" },
      reasoning_effort: "low",
    });
    expect(upstream.lastRequest.body).not.toHaveProperty("top_k");
    expect(response.body).toMatchObject({
      type: "message",
      model: CHAT_MODEL,
      content: [
        { type: "thinking", thinking: "The user wants the weather in Paris." },
        { type: "text", text: "Checking the weather." },
        { type: "tool_use", id: "call_def456", name: "get_weather", input: { city: "Paris" } },
      ],
      stop_reason: "tool_use",
      // 120 prompt tokens, 100 of them read from the cache.
      usage: { input_tokens: 20, cache_read_input_tokens: 100, output_tokens: 40 },
    });
    expect(response.body.id).toMatch(/^msg_/);
    expect(response.headers).not.toHaveProperty(UPSTREAM_ONLY_HEADER);
  });

  it("keeps the client's cache markers and signed thinking on the way to an anthropic-messages upstream", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(anthropicMessagesFixture("upstream-response-tool-call.json")),
    });

    const response = await createMessage({
      ...EVERY_FEATURE_REQUEST,
      model: MESSAGES_MODEL,
    }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      system: [{ type: "text", text: "You are terse.", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user" },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Need the weather.",
              signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h",
            },
            { type: "tool_use", id: "toolu_00first" },
          ],
        },
        { role: "user", content: [{ type: "tool_result" }, { type: "text" }] },
      ],
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    expect(response.body).toMatchObject({
      model: MESSAGES_MODEL,
      content: [
        { type: "thinking", signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h" },
        { type: "text", text: "Checking the weather." },
        { type: "tool_use", id: "toolu_01weather" },
      ],
      usage: { input_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 100 },
    });
  });

  it("streams an openai-chat upstream's answer as named events ending with message_stop", async () => {
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });

    const response = await createMessage({
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
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(events.at(-2)?.data).toMatchObject({
      delta: { stop_reason: "tool_use" },
      usage: { input_tokens: 20, cache_read_input_tokens: 100, output_tokens: 40 },
    });
  });

  it("streams an anthropic-messages upstream's answer with the thinking signature", async () => {
    upstream.reply({
      kind: "stream",
      events: anthropicMessagesFixture("upstream-stream-tool-call.sse"),
    });

    const response = await createMessage({
      ...EVERY_FEATURE_REQUEST,
      model: MESSAGES_MODEL,
      stream: true,
    }).expect(200);

    const deltas = namedEventsOf(response.text).flatMap((event) =>
      event.data.delta ? [event.data.delta] : [],
    );
    expect(deltas).toContainEqual({
      type: "signature_delta",
      signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h",
    });
    expect(namedEventsOf(response.text).at(-1)?.event).toBe("message_stop");
  });

  it("sends a recorded request on, keeping its cache markers and dropping the fields it doesn't know", async () => {
    upstream.reply({
      kind: "stream",
      events: anthropicMessagesFixture("upstream-stream-tool-call.sse"),
    });

    await createMessage({
      ...JSON.parse(anthropicMessagesFixture("client-request.json")),
      model: MESSAGES_MODEL,
    }).expect(200);

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
            {
              type: "image",
              source: { type: "url", url: "https://images.example/cat.jpg" },
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Look up the weather first.",
              signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3h",
            },
            { type: "text", text: "Checking." },
            {
              type: "tool_use",
              id: "toolu_01weather",
              name: "get_weather",
              input: { city: "Paris" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_01weather",
              content: [
                { type: "text", text: "18°C, cloudy", cache_control: { type: "ephemeral" } },
              ],
            },
            { type: "text", text: "And tomorrow?" },
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
      output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object" } } },
      temperature: 0.5,
      top_p: 0.9,
      stop_sequences: ["END"],
      stream: true,
    });
  });

  it("sends a minimal request on without asking for a stream", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await createMessage({ ...MINIMAL_REQUEST, model: CHAT_MODEL }).expect(200);

    expect(upstream.lastRequest.body).toEqual({
      model: UPSTREAM_MODEL_ID,
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 256,
    });
  });

  it("asks for no reasoning when the client disables thinking", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await createMessage({
      ...MINIMAL_REQUEST,
      model: CHAT_MODEL,
      thinking: { type: "disabled" },
    }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ reasoning_effort: "none" });
  });

  it("marks the last block of the conversation when the client asks for automatic caching", async () => {
    await setProviderQuirks(app, db, chatProviderId, { acceptsCacheControl: true });
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await createMessage({
      ...MINIMAL_REQUEST,
      model: CHAT_MODEL,
      cache_control: { type: "ephemeral" },
    }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hi", cache_control: { type: "ephemeral" } }],
        },
      ],
    });
  });

  it("answers with the recorded response, under our own id and Model name", async () => {
    await insertFixtureModel();
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(anthropicMessagesFixture("upstream-response-tool-call.json")),
    });

    const response = await createMessage({
      ...EVERY_FEATURE_REQUEST,
      model: FIXTURE_MODEL,
    }).expect(200);

    const served = { requestId: response.body.id.slice(MESSAGE_ID_PREFIX.length) };
    expect(response.body).toEqual(
      JSON.parse(
        fixtureAsServed(
          anthropicMessagesFixture("client-response.json"),
          FIXTURE_REQUEST_ID,
          served,
        ),
      ),
    );
  });

  it("writes unsigned reasoning with an empty signature, and drops it when the client sends it back", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(anthropicMessagesFixture("upstream-response-tool-call.json")),
    });

    const answered = await createMessage({ ...MINIMAL_REQUEST, model: CHAT_MODEL }).expect(200);
    await createMessage({
      ...MINIMAL_REQUEST,
      model: MESSAGES_MODEL,
      messages: [
        ...MINIMAL_REQUEST.messages,
        {
          role: "assistant",
          content: [answered.body.content[0], { type: "text", text: "Hello." }],
        },
        { role: "user", content: "Again" },
      ],
    }).expect(200);

    expect(answered.body.content[0]).toEqual({
      type: "thinking",
      thinking: "The user wants the weather in Paris.",
      signature: "",
    });
    expect(upstream.lastRequest.body).toMatchObject({
      messages: [
        { role: "user" },
        { role: "assistant", content: [{ type: "text", text: "Hello." }] },
        { role: "user" },
      ],
    });
  });

  it("streams the recorded named events, with the stop reason and usage at the end", async () => {
    await insertFixtureModel();
    upstream.reply({ kind: "stream", events: anthropicStreamWithOneThinkingDelta() });

    const response = await createMessage({
      ...EVERY_FEATURE_REQUEST,
      model: FIXTURE_MODEL,
      stream: true,
    }).expect(200);

    const [messageStart] = namedEventsOf(response.text);
    const messageId = String(messageStart.data.message?.id);
    const served = { requestId: messageId.slice(MESSAGE_ID_PREFIX.length) };
    expect(response.text).toBe(
      fixtureAsServed(anthropicMessagesFixture("client-stream.sse"), FIXTURE_REQUEST_ID, served),
    );
  });

  it("starts a new thinking block for reasoning that follows a signed one", async () => {
    upstream.reply({ kind: "stream", events: TWO_THINKING_BLOCKS_STREAM });

    const response = await createMessage({
      ...MINIMAL_REQUEST,
      model: MESSAGES_MODEL,
      stream: true,
    }).expect(200);

    expect(response.text).toContain(
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"Second."}}',
    );
  });

  it("serves the official Anthropic SDK, streaming and not", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });
    const server = await app.listen(0, "127.0.0.1");
    const client = new Anthropic({
      apiKey,
      baseURL: `http://127.0.0.1:${portOf(server.address())}`,
      maxRetries: 0,
    });
    const params = {
      model: CHAT_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user" as const, content: "What is the weather in Paris?" }],
      tools: [
        {
          name: "get_weather",
          input_schema: { type: "object" as const, properties: { city: { type: "string" } } },
        },
      ],
    };

    const message = await client.messages.create(params);
    const streamed = await client.messages.stream(params).finalMessage();

    expect(message.content.at(-1)).toMatchObject({ type: "tool_use", input: { city: "Paris" } });
    expect(streamed).toMatchObject({
      model: CHAT_MODEL,
      content: [
        { type: "thinking", thinking: "Paris weather." },
        { type: "text", text: "Checking." },
        { type: "tool_use", id: "call_def456", input: { city: "Paris" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 40 },
    });
  });

  it("accepts the API Key as a Bearer token", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await request(app.getHttpServer())
      .post("/v1/messages")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ ...EVERY_FEATURE_REQUEST, model: CHAT_MODEL })
      .expect(200);
  });

  it("answers 401 invalid_api_key in the Anthropic envelope without a valid key", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/messages")
      .set("x-api-key", "rlm_not-a-real-key")
      .send({ ...EVERY_FEATURE_REQUEST, model: CHAT_MODEL })
      .expect(401);

    expect(response.body).toEqual({
      type: "error",
      error: {
        type: "authentication_error",
        message: expect.any(String),
        code: "invalid_api_key",
      },
    });
  });

  it("answers 404 model_not_found in the Anthropic envelope for an unknown Model", async () => {
    const response = await createMessage({ ...EVERY_FEATURE_REQUEST, model: "nope" }).expect(404);

    expect(response.body).toMatchObject({
      type: "error",
      error: { type: "not_found_error", code: "model_not_found" },
    });
  });

  it.each([
    [
      "document input",
      {
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
      },
      "document",
    ],
    ["a body without max_tokens", { max_tokens: undefined }, "max_tokens"],
  ])("refuses %s with 400 naming it", async (_case, fields, named) => {
    const response = await createMessage({
      ...MINIMAL_REQUEST,
      model: CHAT_MODEL,
      ...fields,
    }).expect(400);

    expect(response.body.error.code).toBe("invalid_request");
    expect(response.body.error.message).toContain(named);
    expect(upstream.requests).toHaveLength(0);
  });

  it("refuses an out-of-scope feature with 400 naming it", async () => {
    const response = await createMessage({
      ...EVERY_FEATURE_REQUEST,
      model: CHAT_MODEL,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
    }).expect(400);

    expect(response.body.error).toMatchObject({
      type: "invalid_request_error",
      code: "invalid_request",
    });
    expect(response.body.error.message).toContain("web_search_20260209");
    expect(upstream.requests).toHaveLength(0);
  });
});
