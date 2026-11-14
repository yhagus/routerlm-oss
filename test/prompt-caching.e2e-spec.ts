import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "../src/db/schemas/relations.js";
import { providers } from "../src/db/schemas/index.js";
import { SnapshotService } from "../src/snapshot/providers/snapshot.service.js";
import {
  anthropicMessagesFixture,
  FakeUpstream,
  openAiChatFixture,
  type ReceivedRequest,
} from "./support/fake-upstream.js";
import {
  insertAnthropicMessagesModel,
  insertApiKey,
  insertOpenAiChatModel,
} from "./support/inference.js";
import { createTestApp, setUpFirstUser } from "./support/test-app.js";
import { deleteAllUpstreamData } from "./support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

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

/** The text both strings start with. */
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

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    ({ key } = await insertApiKey(app, db));
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

  function sendChat(content: string): Promise<unknown> {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${key}`)
      .send({ model: "smart", messages: [{ role: "user", content }] })
      .expect(200);
  }

  function sendMessages(messages: unknown[]): Promise<unknown> {
    return request(app.getHttpServer())
      .post("/v1/messages")
      .set("x-api-key", key)
      .send({
        model: "claude",
        max_tokens: 1024,
        system: "You are terse.",
        tools: [GET_TIME_TOOL],
        messages,
      })
      .expect(200);
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
    // The two requests differ only from where the first turn's marker sat.
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
    const { providerId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.baseUrl,
    });
    await db
      .update(providers)
      .set({ quirks: { acceptsPromptCacheKey: true } })
      .where(eq(providers.id, providerId));
    await app.get(SnapshotService).changed();
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
});
