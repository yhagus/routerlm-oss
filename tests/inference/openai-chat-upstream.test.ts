import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { FakeUpstream, openAiChatFixture } from "@tests/support/fake-upstream.js";
import {
  insertApiKey,
  insertOpenAiChatModel,
  setProviderQuirks,
  UPSTREAM_MODEL_ID,
} from "@tests/support/inference.js";
import { createTestApp } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const FIXTURE_CLIENT_REQUEST = {
  model: "smart",
  messages: [
    { role: "system", content: "You are terse." },
    {
      role: "user",
      content: [
        { type: "text", text: "What is in this picture, and what is the weather there?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      ],
    },
    {
      role: "assistant",
      content: null,
      reasoning_content: "Need the weather.",
      tool_calls: [
        {
          id: "call_abc123",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"Paris"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_abc123", content: "18°C, cloudy" },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Current weather for a city",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    },
  ],
  tool_choice: "auto",
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "answer",
      schema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
      strict: true,
    },
  },
  reasoning_effort: "low",
  max_tokens: 512,
  temperature: 0.2,
  stream: true,
};

const MARKED_MESSAGES_REQUEST = {
  model: "smart",
  max_tokens: 256,
  system: [{ type: "text", text: "You are terse.", cache_control: { type: "ephemeral" } }],
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Long document.",
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
        { type: "text", text: "Summarize it." },
      ],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "Done.", cache_control: { type: "ephemeral" } }],
    },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }] },
  ],
};

describe("An openai-chat upstream (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    ({ providerId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.baseUrl,
    }));
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function chat(body: object) {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(body);
  }

  function createMessage(body: object) {
    return request(app.getHttpServer()).post("/v1/messages").set("x-api-key", apiKey).send(body);
  }

  function replyWithCompletion(): void {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });
  }

  it("writes the recorded request to the Provider's chat completions URL, always asking a stream for usage", async () => {
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });

    await chat(FIXTURE_CLIENT_REQUEST).expect(200);

    expect(upstream.lastRequest.path).toBe("/v1/chat/completions");
    expect(upstream.lastRequest.headers["content-type"]).toBe("application/json");
    expect(upstream.lastRequest.body).toEqual(
      JSON.parse(openAiChatFixture("upstream-request.json")),
    );
  });

  it("writes byte-identical bodies for the same request", async () => {
    replyWithCompletion();
    replyWithCompletion();
    const nonStreaming = { ...FIXTURE_CLIENT_REQUEST, stream: false };

    await chat(nonStreaming).expect(200);
    await chat(nonStreaming).expect(200);

    const [first, second] = upstream.requests;
    expect(second.rawBody).toBe(first.rawBody);
  });

  it("sends reasoning back on tool-call turns when the Provider requires it", async () => {
    await setProviderQuirks(app, db, providerId, { reasoningContentInHistory: "tool-call-turns" });
    replyWithCompletion();

    await chat({ ...FIXTURE_CLIENT_REQUEST, stream: false }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      messages: [
        { role: "system" },
        { role: "user" },
        { role: "assistant", reasoning_content: "Need the weather." },
        { role: "tool" },
      ],
    });
  });

  it("writes the client's cache markers as cache_control on the marked content parts for a Provider that accepts them", async () => {
    await setProviderQuirks(app, db, providerId, { acceptsCacheControl: true });
    replyWithCompletion();

    await createMessage(MARKED_MESSAGES_REQUEST).expect(200);

    expect(upstream.lastRequest.body).toEqual({
      model: UPSTREAM_MODEL_ID,
      messages: [
        {
          role: "system",
          content: [{ type: "text", text: "You are terse.", cache_control: { type: "ephemeral" } }],
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Long document.", cache_control: { type: "ephemeral" } },
            { type: "text", text: "Summarize it." },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Done.", cache_control: { type: "ephemeral" } }],
        },
        { role: "tool", tool_call_id: "call_1", content: "ok" },
      ],
      max_tokens: 256,
    });
  });

  it("drops the client's cache markers for a Provider whose quirks don't accept them", async () => {
    replyWithCompletion();

    await createMessage(MARKED_MESSAGES_REQUEST).expect(200);

    expect(upstream.lastRequest.rawBody).not.toContain("cache_control");
    expect(upstream.lastRequest.body).toHaveProperty(["messages", 0], {
      role: "system",
      content: "You are terse.",
    });
  });

  it("answers 502 upstream_error when the upstream's body is not a chat completion", async () => {
    upstream.reply({ kind: "json", status: 200, body: { result: "ok" } });

    const response = await chat({ ...FIXTURE_CLIENT_REQUEST, stream: false }).expect(502);

    expect(response.body.error.code).toBe("upstream_error");
  });

  it("ends the client's stream with an error event when the upstream's stream reports an error", async () => {
    const [firstChunk] = openAiChatFixture("upstream-stream-tool-call.sse").split("\n\n");
    upstream.reply({
      kind: "stream",
      events: `${firstChunk}\n\ndata: {"error":{"message":"overloaded","type":"server_error"}}\n\n`,
    });

    const response = await chat(FIXTURE_CLIENT_REQUEST).expect(200);

    expect(response.text).toContain('"reasoning_content":"Paris"');
    expect(response.text.trim().split("\n\n").at(-1)).toContain('"code":"upstream_error"');
    expect(response.text).not.toContain("[DONE]");
  });

  it("ends a Messages stream with an error event when the upstream interleaves tool call arguments", async () => {
    const chunk = (toolCall: object): string =>
      `data: ${JSON.stringify({
        id: "chatcmpl-upstream-1",
        object: "chat.completion.chunk",
        created: 1794700000,
        model: UPSTREAM_MODEL_ID,
        choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null }],
      })}\n\n`;
    upstream.reply({
      kind: "stream",
      events:
        chunk({
          index: 0,
          id: "call_a",
          type: "function",
          function: { name: "a", arguments: "" },
        }) +
        chunk({
          index: 1,
          id: "call_b",
          type: "function",
          function: { name: "b", arguments: "" },
        }) +
        chunk({ index: 0, function: { arguments: "{}" } }) +
        "data: [DONE]\n\n",
    });

    const response = await createMessage({
      model: "smart",
      max_tokens: 256,
      messages: [{ role: "user", content: "Call both tools." }],
      stream: true,
    }).expect(200);

    const lastEvent = response.text.trim().split("\n\n").at(-1);
    expect(lastEvent).toContain("event: error");
    expect(lastEvent).toContain("upstream_error");
    expect(response.text).not.toContain("message_stop");
  });
});
