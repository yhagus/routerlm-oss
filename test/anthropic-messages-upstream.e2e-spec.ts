import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "../src/db/relations.js";
import { anthropicMessagesFixture, FakeUpstream } from "./support/fake-upstream.js";
import {
  insertAnthropicMessagesModel,
  insertApiKey,
  UPSTREAM_KEY,
  UPSTREAM_MODEL_ID,
} from "./support/inference.js";
import { createTestApp } from "./support/test-app.js";
import { deleteAllUpstreamData } from "./support/upstream.js";

/** A second turn: the client sends back the tool call it got and the tool's result. */
const TOOL_RESULT_TURN_REQUEST = {
  model: "smart",
  messages: [
    { role: "system", content: "You are terse." },
    {
      role: "user",
      content: [
        { type: "text", text: "What is the weather where this was taken?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      ],
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "toolu_00first",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"Paris"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "toolu_00first", content: "18°C, cloudy" },
    { role: "user", content: "And tomorrow?" },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        parameters: { type: "object", properties: { city: { type: "string" } } },
      },
    },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "answer",
      schema: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  reasoning_effort: "low",
};

/** The parts of a streamed chunk these tests read. */
interface ChatCompletionChunk {
  choices: {
    delta: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: { function: { arguments?: string } }[];
    };
  }[];
}

describe("Chat Completions served by an anthropic-messages upstream (e2e)", () => {
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
    await insertAnthropicMessagesModel(app, db, {
      modelName: "smart",
      // The Protocol appends /v1/messages to the Provider's base URL.
      baseUrl: new URL(upstream.baseUrl).origin,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function chat(body: unknown) {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(body as object);
  }

  it("translates images, tool results, reasoning and a JSON schema to Anthropic Messages and back", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(anthropicMessagesFixture("upstream-response-tool-call.json")),
    });

    const response = await chat(TOOL_RESULT_TURN_REQUEST).expect(200);

    expect(upstream.lastRequest.path).toBe("/v1/messages");
    expect(upstream.lastRequest.headers["x-api-key"]).toBe(UPSTREAM_KEY);
    expect(upstream.lastRequest.headers).not.toHaveProperty("authorization");
    expect(upstream.lastRequest.headers["anthropic-version"]).toBe("2023-06-01");
    expect(upstream.lastRequest.body).toMatchObject({
      model: UPSTREAM_MODEL_ID,
      system: [{ type: "text", text: "You are terse." }],
      messages: [
        { role: "user", content: [{ type: "text" }, { type: "image" }] },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_00first", input: { city: "Paris" } }],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_00first" },
            { type: "text", text: "And tomorrow?" },
          ],
        },
      ],
      tools: [{ name: "get_weather", input_schema: { type: "object" } }],
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    expect(response.body).toMatchObject({
      model: "smart",
      choices: [
        {
          message: {
            content: "Checking the weather.",
            reasoning_content: "The user wants the weather in Paris.",
            tool_calls: [
              {
                id: "toolu_01weather",
                function: { name: "get_weather", arguments: '{"city":"Paris"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      // 20 uncached + 100 read from + 30 written to the cache.
      usage: { prompt_tokens: 150, completion_tokens: 40 },
    });
  });

  it("streams the upstream's named events as Chat Completions chunks", async () => {
    upstream.reply({
      kind: "stream",
      events: anthropicMessagesFixture("upstream-stream-tool-call.sse"),
    });

    const response = await chat({
      ...TOOL_RESULT_TURN_REQUEST,
      stream: true,
      stream_options: { include_usage: true },
    }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ stream: true });
    const events = response.text.trim().split("\n\n");
    expect(events.at(-1)).toBe("data: [DONE]");
    const chunks: ChatCompletionChunk[] = events
      .slice(0, -1)
      .map((event) => JSON.parse(event.slice("data: ".length)));
    const deltas = chunks.flatMap((chunk) => chunk.choices.map((choice) => choice.delta));
    expect(deltas.map((delta) => delta.reasoning_content ?? "").join("")).toBe("Paris weather.");
    expect(deltas.map((delta) => delta.content ?? "").join("")).toBe("Checking.");
    expect(
      deltas.flatMap((delta) => delta.tool_calls ?? []).map((call) => call.function.arguments),
    ).toEqual(["", '{"city":', '"Paris"}']);
    expect(chunks.at(-2)).toMatchObject({ choices: [{ finish_reason: "tool_calls" }] });
    expect(chunks.at(-1)).toMatchObject({
      choices: [],
      usage: { prompt_tokens: 150, completion_tokens: 40 },
    });
  });
});
