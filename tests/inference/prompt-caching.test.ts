import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations";
import {
  anthropicMessagesFixture,
  FakeUpstream,
  openAiChatFixture,
  type ReceivedRequest,
} from "@tests/support/fake-upstream";
import {
  insertAnthropicMessagesModel,
  insertApiKey,
  insertOpenAiChatModel,
  setProviderQuirks,
} from "@tests/support/inference";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app";
import { deleteAllUpstreamData } from "@tests/support/upstream";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

const EPHEMERAL = { type: "ephemeral" };

const GET_TIME_TOOL = {
  name: "get_time",
  description: "Current time in a city",
  input_schema: { type: "object", properties: { city: { type: "string" } } },
};
const FIRST_TURN = { role: "user", content: "What time is it in Paris?" };
const SECOND_TURN = [
  FIRST_TURN,
  {
    role: "assistant",
    content: [{ type: "tool_use", id: "toolu_01", name: "get_time", input: { city: "Paris" } }],
  },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "14:05" }] },
];

function sharedPrefixOf(first: string, second: string): string {
  let length = 0;
  while (length < first.length && first[length] === second[length]) {
    length += 1;
  }
  return first.slice(0, length);
}

function promptCacheKeyOf(received: ReceivedRequest): unknown {
  const { body } = received;
  return typeof body === "object" && body !== null && "prompt_cache_key" in body
    ? body.prompt_cache_key
    : undefined;
}

describe("Prompt caching (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let cookie: string;
  let key: string;
  let apiKeyId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    ({ key, id: apiKeyId } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function replyWithAnthropicMessage(): void {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(anthropicMessagesFixture("upstream-response-tool-call.json")),
    });
  }

  function replyWithChatCompletion(): void {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });
  }

  function sendChat(content: string, model = "smart", apiKey = key): Promise<unknown> {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model, messages: [{ role: "user", content }] })
      .expect(200);
  }

  function sendMessages(messages: unknown[], fields: object = {}): Promise<unknown> {
    return request(app.getHttpServer())
      .post("/v1/messages")
      .set("x-api-key", key)
      .send({
        model: "claude",
        max_tokens: 1024,
        system: "You are terse.",
        tools: [GET_TIME_TOOL],
        messages,
        ...fields,
      })
      .expect(200);
  }

  async function insertCacheKeyModel(modelName: string): Promise<string> {
    const { modelId, providerId } = await insertOpenAiChatModel(app, db, {
      modelName,
      baseUrl: upstream.baseUrl,
    });
    await setProviderQuirks(app, db, providerId, { acceptsPromptCacheKey: true });
    return modelId;
  }

  it("marks tools, system and the latest turn, keeping the prefix of consecutive turns byte-identical", async () => {
    await insertAnthropicMessagesModel(app, db, {
      modelName: "claude",
      baseUrl: new URL(upstream.baseUrl).origin,
    });
    replyWithAnthropicMessage();
    replyWithAnthropicMessage();

    await sendMessages([FIRST_TURN]);
    await sendMessages(SECOND_TURN);

    const [first, second] = upstream.requests;
    expect(second.body).toMatchObject({
      system: [{ type: "text", text: "You are terse.", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [{ type: "text", text: "What time is it in Paris?" }] },
        { role: "assistant" },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              content: [{ type: "text", text: "14:05", cache_control: { type: "ephemeral" } }],
            },
          ],
        },
      ],
      tools: [{ name: "get_time", cache_control: { type: "ephemeral" } }],
    });
    expect(sharedPrefixOf(first.rawBody, second.rawBody)).toMatch(
      /"messages":\[\{"role":"user","content":\[\{"type":"text","text":"What time is it in Paris\?"$/,
    );
  });

  it("adds no markers when the Model's switch is off", async () => {
    const { modelId } = await insertAnthropicMessagesModel(app, db, {
      modelName: "claude",
      baseUrl: new URL(upstream.baseUrl).origin,
    });
    await request(app.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .send({ hasAutomaticCacheBreakpoints: false })
      .expect(200);
    replyWithAnthropicMessage();

    await sendMessages(SECOND_TURN);

    expect(upstream.lastRequest.rawBody).not.toContain("cache_control");
  });

  it("leaves the client's own markers as they are", async () => {
    await insertAnthropicMessagesModel(app, db, {
      modelName: "claude",
      baseUrl: new URL(upstream.baseUrl).origin,
    });
    replyWithAnthropicMessage();

    await sendMessages([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "What time is it in Paris?",
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
      },
    ]);

    expect(upstream.lastRequest.rawBody.match(/cache_control/g)).toHaveLength(1);
    expect(upstream.lastRequest.body).toMatchObject({
      messages: [
        {
          content: [
            { text: "What time is it in Paris?", cache_control: { type: "ephemeral", ttl: "1h" } },
          ],
        },
      ],
    });
  });

  it("sends the same prompt cache key on every request of one API Key to an openai-chat Provider that accepts it", async () => {
    await insertCacheKeyModel("smart");
    const chatResponse = JSON.parse(openAiChatFixture("upstream-response-tool-call.json"));
    upstream.reply({ kind: "json", status: 200, body: chatResponse });
    upstream.reply({ kind: "json", status: 200, body: chatResponse });

    await sendChat("Hi");
    await sendChat("Hi again");

    const [first, second] = upstream.requests;
    expect(promptCacheKeyOf(first)).toEqual(expect.any(String));
    expect(promptCacheKeyOf(second)).toBe(promptCacheKeyOf(first));
  });

  it("sends no prompt cache key to an openai-chat Provider without the quirk", async () => {
    await insertOpenAiChatModel(app, db, { modelName: "smart", baseUrl: upstream.baseUrl });
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await sendChat("Hi");

    expect(promptCacheKeyOf(upstream.lastRequest)).toBeUndefined();
  });

  it("marks only the last tool and the last part of the system prompt", async () => {
    await insertAnthropicMessagesModel(app, db, {
      modelName: "claude",
      baseUrl: new URL(upstream.baseUrl).origin,
    });
    replyWithAnthropicMessage();

    await sendMessages([FIRST_TURN], {
      system: [
        { type: "text", text: "You are Acme's assistant." },
        { type: "text", text: "Answer in French." },
      ],
      tools: [{ ...GET_TIME_TOOL, name: "get_weather" }, GET_TIME_TOOL],
    });

    expect(upstream.lastRequest.body).toMatchObject({
      system: [
        { type: "text", text: "You are Acme's assistant." },
        { type: "text", text: "Answer in French.", cache_control: EPHEMERAL },
      ],
      tools: [{ name: "get_weather" }, { name: "get_time", cache_control: EPHEMERAL }],
    });
    expect(upstream.lastRequest.rawBody.match(/cache_control/g)).toHaveLength(3);
  });

  it("marks only the latest turn when the Provider accepts a single marker", async () => {
    const { providerId } = await insertAnthropicMessagesModel(app, db, {
      modelName: "claude",
      baseUrl: new URL(upstream.baseUrl).origin,
    });
    await setProviderQuirks(app, db, providerId, { cacheMarkerLimit: 1 });
    replyWithAnthropicMessage();

    await sendMessages(SECOND_TURN);

    expect(upstream.lastRequest.rawBody.match(/cache_control/g)).toHaveLength(1);
    expect(upstream.lastRequest.body).toHaveProperty(
      ["messages", 2, "content", 0, "content"],
      [{ type: "text", text: "14:05", cache_control: EPHEMERAL }],
    );
  });

  it("marks the last part of the latest turn that is written upstream, skipping empty text", async () => {
    await insertAnthropicMessagesModel(app, db, {
      modelName: "claude",
      baseUrl: new URL(upstream.baseUrl).origin,
    });
    replyWithAnthropicMessage();

    await sendMessages([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: "https://example.com/cat.png" } },
          { type: "text", text: "" },
        ],
      },
    ]);

    expect(upstream.lastRequest.body).toHaveProperty(
      ["messages", 0, "content"],
      [
        {
          type: "image",
          source: { type: "url", url: "https://example.com/cat.png" },
          cache_control: EPHEMERAL,
        },
      ],
    );
  });

  it("sends another prompt cache key for another Model, and for a Playground User with the API Key's id", async () => {
    await insertCacheKeyModel("smart");
    await insertCacheKeyModel("other");
    const me = await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie);
    const { key: keyWithUsersId } = await insertApiKey(app, db, [], me.body.id);
    replyWithChatCompletion();
    replyWithChatCompletion();
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });

    await sendChat("Hi", "smart", keyWithUsersId);
    await sendChat("Hi", "other", keyWithUsersId);
    await request(app.getHttpServer())
      .post("/api/playground/chat/completions")
      .set("Cookie", cookie)
      .send({ model: "smart", messages: [{ role: "user", content: "Hi" }], stream: true })
      .expect(200);

    const [apiKeyOnSmart, apiKeyOnOther, playgroundOnSmart] =
      upstream.requests.map(promptCacheKeyOf);
    expect(apiKeyOnSmart).toEqual(expect.any(String));
    expect(apiKeyOnOther).not.toBe(apiKeyOnSmart);
    expect(playgroundOnSmart).toEqual(expect.any(String));
    expect(playgroundOnSmart).not.toBe(apiKeyOnSmart);
  });

  it("sends a prompt cache key that reveals neither the API Key nor the Model", async () => {
    const modelId = await insertCacheKeyModel("smart");
    replyWithChatCompletion();

    await sendChat("Hi");

    const cacheKey = String(promptCacheKeyOf(upstream.lastRequest));
    expect(cacheKey).not.toContain(apiKeyId);
    expect(cacheKey).not.toContain(modelId);
  });
});
