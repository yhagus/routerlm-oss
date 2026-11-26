import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations";
import type { ParameterPolicy } from "@/db/schemas";
import {
  anthropicMessagesFixture,
  type FakeReply,
  FakeUpstream,
  openAiChatFixture,
} from "@tests/support/fake-upstream";
import {
  addProviderAccount,
  insertAnthropicMessagesModel,
  insertApiKey,
  insertOpenAiChatModel,
} from "@tests/support/inference";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app";
import { deleteAllUpstreamData } from "@tests/support/upstream";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

const CHAT_COMPLETION: FakeReply = {
  kind: "json",
  status: 200,
  body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
};
const ANTHROPIC_MESSAGE: FakeReply = {
  kind: "json",
  status: 200,
  body: JSON.parse(anthropicMessagesFixture("upstream-response-tool-call.json")),
};

describe("Parameter Policy (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let cookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  it("applies the Model's policy, saved from the dashboard, to a Chat Completions request for an openai-chat upstream", async () => {
    const { modelId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.baseUrl,
    });
    const { key } = await insertApiKey(app, db);
    await request(app.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .send({
        parameterPolicy: {
          forced: { temperature: 0 },
          caps: { maxOutputTokens: 1024 },
          systemPrompt: "You are Acme's assistant.",
        },
      })
      .expect(200);
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${key}`)
      .send({
        model: "smart",
        messages: [
          { role: "system", content: "Answer in French." },
          { role: "user", content: "Hi" },
        ],
        temperature: 1.5,
        max_tokens: 64_000,
      })
      .expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      messages: [
        { role: "system", content: "You are Acme's assistant." },
        { role: "system", content: "Answer in French." },
        { role: "user", content: "Hi" },
      ],
      max_tokens: 1024,
      temperature: 0,
    });
  });

  it("lets a Route override, saved from the dashboard, win on a Messages request for an anthropic-messages upstream", async () => {
    const { modelId, routeId } = await insertAnthropicMessagesModel(app, db, {
      modelName: "claude-like",
      baseUrl: new URL(upstream.baseUrl).origin,
    });
    const { key } = await insertApiKey(app, db);
    const server = app.getHttpServer();
    await request(server)
      .patch(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .send({ parameterPolicy: { systemPrompt: "Model prompt", defaults: { temperature: 0.2 } } })
      .expect(200);
    await request(server)
      .patch(`/api/models/${modelId}/routes/${routeId}`)
      .set("Cookie", cookie)
      .send({ parameterPolicyOverride: { systemPrompt: "Route prompt" } })
      .expect(200);
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(anthropicMessagesFixture("upstream-response-tool-call.json")),
    });

    await request(server)
      .post("/v1/messages")
      .set("x-api-key", key)
      .send({
        model: "claude-like",
        max_tokens: 256,
        system: "Answer in French.",
        messages: [{ role: "user", content: "Hi" }],
      })
      .expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      system: [
        { type: "text", text: "Route prompt" },
        { type: "text", text: "Answer in French." },
      ],
      temperature: 0.2,
    });
  });

  it("refuses to save a policy whose default is above its cap", async () => {
    const { modelId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.baseUrl,
    });

    await request(app.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .send({ parameterPolicy: { defaults: { temperature: 1.5 }, caps: { temperature: 1 } } })
      .expect(400);
  });

  describe("on each parameter", () => {
    const CHAT_MODEL = "via-chat";
    const MESSAGES_MODEL = "via-messages";

    let key: string;
    let chatModel: { modelId: string; routeId: string; providerId: string };
    let messagesModelId: string;
    let messagesRouteId: string;

    beforeEach(async () => {
      chatModel = await insertOpenAiChatModel(app, db, {
        modelName: CHAT_MODEL,
        baseUrl: upstream.baseUrl,
      });
      ({ modelId: messagesModelId, routeId: messagesRouteId } = await insertAnthropicMessagesModel(
        app,
        db,
        {
          modelName: MESSAGES_MODEL,
          baseUrl: new URL(upstream.baseUrl).origin,
        },
      ));
      ({ key } = await insertApiKey(app, db));
    });

    async function saveModelPolicy(modelId: string, parameterPolicy: ParameterPolicy) {
      await request(app.getHttpServer())
        .patch(`/api/models/${modelId}`)
        .set("Cookie", cookie)
        .send({ parameterPolicy })
        .expect(200);
    }

    async function saveRouteOverride(parameterPolicyOverride: ParameterPolicy) {
      await request(app.getHttpServer())
        .patch(`/api/models/${chatModel.modelId}/routes/${chatModel.routeId}`)
        .set("Cookie", cookie)
        .send({ parameterPolicyOverride })
        .expect(200);
    }

    async function chat(body: object): Promise<void> {
      upstream.reply(CHAT_COMPLETION);
      await request(app.getHttpServer())
        .post("/v1/chat/completions")
        .set("Authorization", `Bearer ${key}`)
        .send({ model: CHAT_MODEL, messages: [{ role: "user", content: "Hi" }], ...body })
        .expect(200);
    }

    async function createMessage(body: object): Promise<void> {
      upstream.reply(ANTHROPIC_MESSAGE);
      await request(app.getHttpServer())
        .post("/v1/messages")
        .set("x-api-key", key)
        .send({
          model: MESSAGES_MODEL,
          max_tokens: 256,
          messages: [{ role: "user", content: "Hi" }],
          ...body,
        })
        .expect(200);
    }

    it.each<[string, ParameterPolicy, object, object]>([
      [
        "fills a parameter the client omitted with its default",
        { defaults: { temperature: 0.3, stopSequences: ["END"] } },
        {},
        { temperature: 0.3, stop: ["END"] },
      ],
      [
        "keeps the client's value over a default",
        { defaults: { topP: 0.9, stopSequences: ["END"] } },
        { top_p: 0.5, stop: ["STOP"] },
        { top_p: 0.5, stop: ["STOP"] },
      ],
      [
        "replaces the client's value with a forced one",
        { forced: { temperature: 0, stopSequences: ["END"] } },
        { temperature: 1.2, stop: ["STOP"] },
        { temperature: 0, stop: ["END"] },
      ],
      [
        "clamps a client value above its cap and leaves one below it",
        { caps: { maxOutputTokens: 4096, temperature: 1 } },
        { max_tokens: 64_000, temperature: 0.2 },
        { max_tokens: 4096, temperature: 0.2 },
      ],
      [
        "caps a reasoning effort by its order",
        { caps: { reasoningEffort: "medium" } },
        { reasoning_effort: "xhigh" },
        { reasoning_effort: "medium" },
      ],
      [
        "keeps a reasoning effort below its cap",
        { caps: { reasoningEffort: "medium" } },
        { reasoning_effort: "low" },
        { reasoning_effort: "low" },
      ],
      [
        "defaults the reasoning effort when the client asked for no reasoning",
        { defaults: { reasoningEffort: "low" } },
        {},
        { reasoning_effort: "low" },
      ],
    ])("%s", async (_behaviour, policy, clientFields, sentUpstream) => {
      await saveModelPolicy(chatModel.modelId, policy);

      await chat(clientFields);

      expect(upstream.lastRequest.body).toMatchObject(sentUpstream);
    });

    it("does not invent a value for a capped parameter the client omitted", async () => {
      await saveModelPolicy(chatModel.modelId, { caps: { maxOutputTokens: 4096 } });

      await chat({});

      expect(upstream.lastRequest.body).not.toHaveProperty("max_tokens");
    });

    it("keeps the client's thinking budget over a default reasoning effort", async () => {
      await saveModelPolicy(messagesModelId, { defaults: { reasoningEffort: "low" } });

      await createMessage({ thinking: { type: "enabled", budget_tokens: 2048 } });

      expect(upstream.lastRequest.body).toMatchObject({
        thinking: { type: "enabled", budget_tokens: 2048 },
      });
      expect(upstream.lastRequest.body).not.toHaveProperty("output_config");
    });

    it("replaces the client's whole reasoning setting with a forced effort, dropping its thinking budget", async () => {
      await saveModelPolicy(messagesModelId, { forced: { reasoningEffort: "medium" } });

      await createMessage({
        thinking: { type: "enabled", budget_tokens: 8000 },
        output_config: { effort: "high" },
      });

      expect(upstream.lastRequest.body).toMatchObject({
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
      });
    });

    it.each([
      ["clamps a thinking budget above the budget cap", 8000, 2048],
      ["keeps a thinking budget below the budget cap", 1500, 1500],
    ])("%s", async (_behaviour, clientBudget, sentBudget) => {
      await saveModelPolicy(messagesModelId, { caps: { reasoningBudgetTokens: 2048 } });

      await createMessage({ thinking: { type: "enabled", budget_tokens: clientBudget } });

      expect(upstream.lastRequest.body).toMatchObject({
        thinking: { type: "enabled", budget_tokens: sentBudget },
      });
    });

    it("takes the thinking budget cap from the Route override over the Model's", async () => {
      await saveModelPolicy(messagesModelId, { caps: { reasoningBudgetTokens: 2048 } });
      await request(app.getHttpServer())
        .patch(`/api/models/${messagesModelId}/routes/${messagesRouteId}`)
        .set("Cookie", cookie)
        .send({ parameterPolicyOverride: { caps: { reasoningBudgetTokens: 4096 } } })
        .expect(200);

      await createMessage({ thinking: { type: "enabled", budget_tokens: 8000 } });

      expect(upstream.lastRequest.body).toMatchObject({
        thinking: { type: "enabled", budget_tokens: 4096 },
      });
    });

    it("lets an effort cap alone leave a thinking budget unchanged", async () => {
      await saveModelPolicy(messagesModelId, { caps: { reasoningEffort: "low" } });

      await createMessage({ thinking: { type: "enabled", budget_tokens: 8000 } });

      expect(upstream.lastRequest.body).toMatchObject({
        thinking: { type: "enabled", budget_tokens: 8000 },
      });
    });

    it("does not invent a thinking budget the client omitted", async () => {
      await saveModelPolicy(messagesModelId, { caps: { reasoningBudgetTokens: 2048 } });

      await createMessage({});

      expect(upstream.lastRequest.body).not.toHaveProperty("thinking");
    });

    it("places the system prompt verbatim before the client's system content", async () => {
      await saveModelPolicy(chatModel.modelId, {
        systemPrompt: "You are Acme's assistant. {{user}} is not a variable.",
      });

      await chat({
        messages: [
          { role: "system", content: "Answer in French." },
          { role: "user", content: "Hi" },
        ],
      });

      expect(upstream.lastRequest.body).toMatchObject({
        messages: [
          { role: "system", content: "You are Acme's assistant. {{user}} is not a variable." },
          { role: "system", content: "Answer in French." },
          { role: "user", content: "Hi" },
        ],
      });
    });

    it("adds no system part for an empty system prompt", async () => {
      await saveModelPolicy(chatModel.modelId, { systemPrompt: "" });

      await chat({});

      expect(upstream.lastRequest.body).toMatchObject({
        messages: [{ role: "user", content: "Hi" }],
      });
    });

    it("applies the policy to the client's own request on every Attempt", async () => {
      await addProviderAccount(app, db, chatModel.providerId, {
        key: "sk-backup-secret-9876543210",
        priority: 1,
      });
      await saveModelPolicy(chatModel.modelId, {
        forced: { temperature: 0 },
        systemPrompt: "Be brief.",
      });
      upstream.reply({ kind: "json", status: 503, body: { error: "overloaded" } });

      await chat({ temperature: 1.5 });

      expect(upstream.requests).toHaveLength(2);
      expect(upstream.lastRequest.body).toMatchObject({
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Hi" },
        ],
        temperature: 0,
      });
    });

    it("takes every rule for a parameter from the Route override when the override sets that parameter", async () => {
      await saveModelPolicy(chatModel.modelId, {
        forced: { temperature: 0.2 },
        caps: { maxOutputTokens: 4096 },
      });
      await saveRouteOverride({ defaults: { temperature: 0.7 } });

      await chat({ temperature: 1.5, max_tokens: 64_000 });

      expect(upstream.lastRequest.body).toMatchObject({ temperature: 1.5, max_tokens: 4096 });
    });

    it.each<[string, ParameterPolicy, object[]]>([
      ["an empty system prompt clears", { systemPrompt: "" }, [{ role: "user", content: "Hi" }]],
      [
        "no system prompt keeps",
        {},
        [
          { role: "system", content: "Model prompt" },
          { role: "user", content: "Hi" },
        ],
      ],
    ])("a Route override with %s the Model's system prompt", async (_case, override, sent) => {
      await saveModelPolicy(chatModel.modelId, { systemPrompt: "Model prompt" });
      await saveRouteOverride(override);

      await chat({});

      expect(upstream.lastRequest.body).toMatchObject({ messages: sent });
    });
  });
});
