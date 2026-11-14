import type { AddressInfo } from "node:net";
import type { NestNodeApplication } from "@nestjs/platform-node";
import pg from "pg";
import request from "supertest";
import type { Database } from "../src/db/relations.js";
import { FakeUpstream, openAiChatFixture, UPSTREAM_ONLY_HEADER } from "./support/fake-upstream.js";
import {
  insertApiKey,
  insertOpenAiChatModel,
  UPSTREAM_KEY,
  UPSTREAM_MODEL_ID,
} from "./support/inference.js";
import { createTestApp } from "./support/test-app.js";
import { deleteAllUpstreamData } from "./support/upstream.js";

const EVERY_FEATURE_REQUEST = {
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
  ],
  tools: [
    {
      type: "function",
      function: { name: "get_weather", parameters: { type: "object", properties: {} } },
    },
  ],
  response_format: {
    type: "json_schema",
    json_schema: { name: "answer", schema: { type: "object" } },
  },
  reasoning_effort: "low",
  logit_bias: { "50256": -100 },
};

describe("Chat Completions (e2e)", () => {
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
    await insertOpenAiChatModel(app, db, { modelName: "smart", baseUrl: upstream.baseUrl });
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

  it("serves a request with images, tools, reasoning and a JSON schema from the upstream, as our Model", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    const response = await chat(EVERY_FEATURE_REQUEST).expect(200);

    expect(upstream.lastRequest.path).toBe("/v1/chat/completions");
    expect(upstream.lastRequest.headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(upstream.lastRequest.body).toMatchObject({
      model: UPSTREAM_MODEL_ID,
      messages: [
        { role: "system", content: "You are terse." },
        { role: "user", content: [{ type: "text" }, { type: "image_url" }] },
      ],
      tools: [{ type: "function", function: { name: "get_weather" } }],
      response_format: { type: "json_schema" },
      reasoning_effort: "low",
    });
    expect(upstream.lastRequest.body).not.toHaveProperty("logit_bias");
    expect(response.body).toMatchObject({
      object: "chat.completion",
      model: "smart",
      choices: [
        {
          message: {
            content: "Checking the weather.",
            reasoning_content: "The user wants the weather in Paris.",
            tool_calls: [{ id: "call_def456", function: { name: "get_weather" } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    });
    expect(response.body.id).toMatch(/^chatcmpl-/);
    expect(response.body.id).not.toBe("chatcmpl-upstream-9f8e7d");
    expect(response.headers).not.toHaveProperty(UPSTREAM_ONLY_HEADER);
  });

  it("streams the upstream's answer as Chat Completions chunks ending with [DONE]", async () => {
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });

    const response = await chat({
      ...EVERY_FEATURE_REQUEST,
      stream: true,
      stream_options: { include_usage: true },
    }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(response.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(response.headers).not.toHaveProperty(UPSTREAM_ONLY_HEADER);
    const events = response.text.trim().split("\n\n");
    expect(events.at(-1)).toBe("data: [DONE]");
    const chunks = events.slice(0, -1).map((event) => JSON.parse(event.slice("data: ".length)));
    expect(chunks.every((chunk) => chunk.model === "smart")).toBe(true);
    expect(chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join("")).toBe("Checking.");
    expect(chunks.at(-1)).toMatchObject({ choices: [], usage: { completion_tokens: 40 } });
  });

  it("cancels the upstream call when the client disconnects mid-stream", async () => {
    const firstChunk = openAiChatFixture("upstream-stream-tool-call.sse").split("\n\n")[0] + "\n\n";
    upstream.reply({ kind: "stream", events: firstChunk, holdOpen: true });
    const upstreamClosed = upstream.waitForDisconnect();
    const server = await app.listen(0, "127.0.0.1");
    const { port } = server.address() as AddressInfo;
    const client = new AbortController();

    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ ...EVERY_FEATURE_REQUEST, stream: true }),
      signal: client.signal,
    });
    await response.body?.getReader().read();
    client.abort();

    await upstreamClosed;
  });

  it("answers with no upstream error text when the upstream fails", async () => {
    upstream.reply({
      kind: "json",
      status: 500,
      body: { error: { message: "shard 7 of cluster eu-3 is on fire" } },
    });

    const response = await chat(EVERY_FEATURE_REQUEST).expect(502);

    expect(response.body.error.code).toBe("upstream_error");
    expect(response.text).not.toContain("shard 7");
  });

  it("answers 429 upstream_rate_limited when the upstream rate limits", async () => {
    upstream.reply({ kind: "json", status: 429, body: { error: { message: "slow down" } } });

    const response = await chat(EVERY_FEATURE_REQUEST).expect(429);

    expect(response.body.error).toMatchObject({
      code: "upstream_rate_limited",
      type: "rate_limit_error",
    });
  });

  it("answers 400 invalid_request when the upstream refuses the request itself", async () => {
    upstream.reply({ kind: "json", status: 400, body: { error: { message: "bad schema" } } });

    const response = await chat(EVERY_FEATURE_REQUEST).expect(400);

    expect(response.body.error.code).toBe("invalid_request");
  });

  it("answers 504 upstream_timeout when the upstream does not answer in time", async () => {
    await insertOpenAiChatModel(app, db, {
      modelName: "slow",
      baseUrl: upstream.baseUrl,
      totalTimeoutMs: 200,
    });
    upstream.reply({ kind: "hang" });

    const response = await chat({ ...EVERY_FEATURE_REQUEST, model: "slow" }).expect(504);

    expect(response.body.error.code).toBe("upstream_timeout");
  });

  it("refuses an out-of-scope feature with 400 naming it", async () => {
    const response = await chat({ ...EVERY_FEATURE_REQUEST, n: 3 }).expect(400);

    expect(response.body.error).toMatchObject({
      code: "invalid_request",
      type: "invalid_request_error",
    });
    expect(response.body.error.message).toContain("`n`");
    expect(upstream.requests).toHaveLength(0);
  });

  it("refuses a request no Route can serve with 400 no_capable_route", async () => {
    await insertOpenAiChatModel(app, db, {
      modelName: "text-only",
      baseUrl: upstream.baseUrl,
      capabilities: [],
    });

    const response = await chat({ ...EVERY_FEATURE_REQUEST, model: "text-only" }).expect(400);

    expect(response.body.error.code).toBe("no_capable_route");
  });

  it("answers 404 model_not_found for an unknown Model", async () => {
    const response = await chat({ ...EVERY_FEATURE_REQUEST, model: "nope" }).expect(404);

    expect(response.body.error.code).toBe("model_not_found");
  });

  it("answers 403 model_not_allowed for a Model the API Key may not use", async () => {
    const other = await insertOpenAiChatModel(app, db, {
      modelName: "other",
      baseUrl: upstream.baseUrl,
    });
    ({ key: apiKey } = await insertApiKey(app, db, [other.modelId]));

    const response = await chat(EVERY_FEATURE_REQUEST).expect(403);

    expect(response.body.error.code).toBe("model_not_allowed");
  });

  it("answers 401 invalid_api_key in the OpenAI envelope without a valid key", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer rlm_unknown_key")
      .send(EVERY_FEATURE_REQUEST)
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

  it("answers 413 request_too_large for a body over 20 MB", async () => {
    const huge = "x".repeat(21 * 1024 * 1024);

    const response = await chat({
      ...EVERY_FEATURE_REQUEST,
      messages: [{ role: "user", content: huge }],
    }).expect(413);

    expect(response.body.error.code).toBe("request_too_large");
  });

  it("makes no PostgreSQL query while serving a request", async () => {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });
    const query = vi.spyOn(pg.Client.prototype, "query");

    await chat(EVERY_FEATURE_REQUEST).expect(200);

    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
  });
});
