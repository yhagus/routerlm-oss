import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "../src/db/relations.js";
import {
  anthropicMessagesFixture,
  FakeUpstream,
  openAiChatFixture,
} from "./support/fake-upstream.js";
import {
  insertAnthropicMessagesModel,
  insertApiKey,
  insertOpenAiChatModel,
} from "./support/inference.js";
import { createTestApp, setUpFirstUser } from "./support/test-app.js";
import { deleteAllUpstreamData } from "./support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

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
});
