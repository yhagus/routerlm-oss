import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { routes } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { type FakeReply, FakeUpstream, openAiChatFixture } from "@tests/support/fake-upstream.js";
import {
  addOpenAiChatRoute,
  ALL_CAPABILITIES,
  insertApiKey,
  insertOpenAiChatModel,
  type UpstreamModelLimits,
} from "@tests/support/inference.js";
import { createTestApp } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const SUCCESS: FakeReply = {
  kind: "json",
  status: 200,
  body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
};
const SERVER_ERROR: FakeReply = { kind: "json", status: 503, body: { error: "overloaded" } };

describe("Route selection (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let modelId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function baseUrlOf(routeName: string): string {
    return `${upstream.baseUrl}/${routeName}`;
  }

  function attemptedRoutes(): string[] {
    return upstream.requests.map((received) =>
      received.path.replace("/v1/", "").replace("/chat/completions", ""),
    );
  }

  async function insertModelWithRoute(
    routeName: string,
    limits: UpstreamModelLimits = {},
  ): Promise<void> {
    ({ modelId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: baseUrlOf(routeName),
      ...limits,
    }));
  }

  function addRoute(routeName: string, priority: number, limits: UpstreamModelLimits = {}) {
    return addOpenAiChatRoute(app, db, modelId, {
      baseUrl: baseUrlOf(routeName),
      providerSlug: `acme-${routeName}`,
      priority,
      ...limits,
    });
  }

  function chat(body: object) {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model: "smart", ...body });
  }

  it("tries the Routes in priority order, skipping a disabled one", async () => {
    await insertModelWithRoute("first");
    await addRoute("third", 3);
    const { routeId: disabledRouteId } = await addRoute("disabled", 1);
    await addRoute("second", 2);
    await db.update(routes).set({ isEnabled: false }).where(eq(routes.id, disabledRouteId));
    await app.get(SnapshotService).changed();
    upstream.reply(SERVER_ERROR);
    upstream.reply(SERVER_ERROR);
    upstream.reply(SUCCESS);

    await chat({ messages: [{ role: "user", content: "Hi" }] }).expect(200);

    expect(attemptedRoutes()).toEqual(["first", "second", "third"]);
  });

  it("skips Routes whose Upstream Model lacks a Capability the request needs", async () => {
    await insertModelWithRoute("text-only", { capabilities: [] });
    await addRoute("no-reasoning", 1, { capabilities: ["vision", "tools", "structured-output"] });
    await addRoute("everything", 2, { capabilities: ALL_CAPABILITIES });
    upstream.reply(SUCCESS);

    await chat({
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "https://images.example/cat.jpg" } }],
        },
      ],
      tools: [{ type: "function", function: { name: "get_weather", parameters: {} } }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "answer", schema: { type: "object" } },
      },
      reasoning_effort: "high",
    }).expect(200);

    expect(attemptedRoutes()).toEqual(["everything"]);
  });

  it("never tries a Route to an Upstream Model of another Kind, even one written past the API", async () => {
    await insertModelWithRoute("chat");
    await addRoute("image", -1, { kind: "image" });
    upstream.reply(SUCCESS);

    await chat({ messages: [{ role: "user", content: "Hi" }] }).expect(200);

    expect(attemptedRoutes()).toEqual(["chat"]);
  });

  it("skips Routes whose context is too small for the prompt and the requested output", async () => {
    await insertModelWithRoute("small", { contextSize: 4_000 });
    await addRoute("large", 1, { contextSize: 128_000 });
    upstream.reply(SUCCESS);

    await chat({
      messages: [{ role: "user", content: "word".repeat(100) }],
      max_tokens: 3_950,
    }).expect(200);

    expect(attemptedRoutes()).toEqual(["large"]);
  });
});
