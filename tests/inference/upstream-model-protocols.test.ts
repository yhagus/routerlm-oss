import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { providers, type UpstreamProtocol, upstreamModels } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import {
  anthropicMessagesFixture,
  type FakeReply,
  FakeUpstream,
  openAiChatFixture,
} from "@tests/support/fake-upstream.js";
import { insertApiKey, insertOpenAiChatModel } from "@tests/support/inference.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const ANTHROPIC_PATH_PREFIX = "/anthropic";
const OPENAI_CHAT_PATH = "/v1/chat/completions";
const ANTHROPIC_MESSAGES_PATH = `${ANTHROPIC_PATH_PREFIX}/v1/messages`;

const ANTHROPIC_ANSWER: FakeReply = {
  kind: "json",
  status: 200,
  body: JSON.parse(anthropicMessagesFixture("upstream-response-tool-call.json")),
};
const OPENAI_CHAT_ANSWER: FakeReply = {
  kind: "json",
  status: 200,
  body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
};

const CHAT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };
const MESSAGES_REQUEST = {
  model: "smart",
  max_tokens: 64,
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
};

describe("The Provider Endpoint an Upstream Model is sent through (e2e)", () => {
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
    await db
      .update(providers)
      .set({
        endpoints: [
          { kind: "chat", protocol: "openai-chat", baseUrl: upstream.baseUrl },
          {
            kind: "chat",
            protocol: "anthropic-messages",
            baseUrl: `${upstream.origin}${ANTHROPIC_PATH_PREFIX}`,
          },
        ],
      })
      .where(eq(providers.id, providerId));
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  async function listProtocols(protocols: UpstreamProtocol[]): Promise<void> {
    await db
      .update(upstreamModels)
      .set({ protocols })
      .where(eq(upstreamModels.providerId, providerId));
    await app.get(SnapshotService).changed();
  }

  function chat() {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(CHAT_REQUEST);
  }

  function createMessage() {
    return request(app.getHttpServer())
      .post("/v1/messages")
      .set("x-api-key", apiKey)
      .send(MESSAGES_REQUEST);
  }

  it("sends an Anthropic Messages client through the model's anthropic-messages endpoint unchanged", async () => {
    await listProtocols(["openai-chat", "anthropic-messages"]);
    upstream.reply(ANTHROPIC_ANSWER);

    await createMessage().expect(200);

    expect(upstream.lastRequest.path).toBe(ANTHROPIC_MESSAGES_PATH);
    expect(upstream.lastRequest.body).toMatchObject({ messages: MESSAGES_REQUEST.messages });
  });

  it("sends a Chat Completions client through the openai-chat endpoint of a model that lists both", async () => {
    await listProtocols(["anthropic-messages", "openai-chat"]);
    upstream.reply(OPENAI_CHAT_ANSWER);

    await chat().expect(200);

    expect(upstream.lastRequest.path).toBe(OPENAI_CHAT_PATH);
  });

  it("translates a Chat Completions client to the only Protocol the model lists", async () => {
    await listProtocols(["anthropic-messages"]);
    upstream.reply(ANTHROPIC_ANSWER);

    const response = await chat().expect(200);

    expect(upstream.lastRequest.path).toBe(ANTHROPIC_MESSAGES_PATH);
    expect(response.body).toMatchObject({ object: "chat.completion", model: "smart" });
  });

  it("probes through the model's first listed endpoint", async () => {
    await deleteAllUsers(db);
    const cookie = await setUpFirstUser(app, ADA);
    await listProtocols(["anthropic-messages", "openai-chat"]);
    const [{ id: upstreamModelRowId }] = await db
      .select({ id: upstreamModels.id })
      .from(upstreamModels);
    upstream.reply(ANTHROPIC_ANSWER);

    await request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelRowId}/probe`)
      .set("Cookie", cookie)
      .expect(200);

    expect(upstream.lastRequest.path).toBe(ANTHROPIC_MESSAGES_PATH);
  });
});
