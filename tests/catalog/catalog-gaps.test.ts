import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import { providers, upstreamModels } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import { FakeUpstream } from "@tests/support/fake-upstream.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const modelsDev = await FakeUpstream.start();
process.env.MODELS_DEV_API_URL = `${modelsDev.origin}/api.json`;
process.env.MODELS_DEV_TIMEOUT_MS = "1000";
const { createTestApp, setUpFirstUser } = await import("@tests/support/test-app.js");

const OPERATOR = { email: "ops@example.com", password: "ops password" };

const PROVIDER_SLUG = "anthropic";
const HELD_MODEL_ID = "claude-held";

function modelsDevModel(id: string, releaseDate: string) {
  return { id, name: `Name of ${id}`, release_date: releaseDate };
}

function replyWithAnthropicModels(models: Array<ReturnType<typeof modelsDevModel>>): void {
  modelsDev.replyTo("/api.json", {
    kind: "json",
    status: 200,
    body: {
      anthropic: { models: Object.fromEntries(models.map((model) => [model.id, model])) },
      unmapped: { models: { "not-ours": modelsDevModel("not-ours", "2026-11-01") } },
    },
  });
}

describe("Catalog Gaps API (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;

  beforeEach(async () => {
    modelsDev.reset();
    ({ app, db } = await createTestApp());
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    const [provider] = await db
      .insert(providers)
      .values({
        slug: PROVIDER_SLUG,
        name: "Anthropic",
        endpoints: [
          {
            kind: "chat",
            protocol: "anthropic-messages",
            baseUrl: "https://api.anthropic.example",
          },
        ],
        authStyle: "x-api-key",
      })
      .returning({ id: providers.id });
    await db
      .insert(upstreamModels)
      .values({ providerId: provider.id, upstreamModelId: HELD_MODEL_ID, contextSize: 200_000 });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await modelsDev.close();
  });

  function listGaps() {
    return request(app.getHttpServer()).get("/api/catalog/gaps").set("Cookie", cookie);
  }

  it("reports a newest model the Catalog lacks, and not one it holds", async () => {
    replyWithAnthropicModels([
      modelsDevModel(HELD_MODEL_ID, "2026-10-01"),
      modelsDevModel("claude-new", "2026-11-05"),
    ]);

    const response = await listGaps().expect(200);

    expect(response.body.gaps).toEqual([
      {
        providerSlug: PROVIDER_SLUG,
        providerName: "Anthropic",
        upstreamModelId: "claude-new",
        name: "Name of claude-new",
        releaseDate: "2026-11-05",
      },
    ]);
    expect(new Date(response.body.checkedAt).getTime()).toBeGreaterThan(0);
  });

  it("looks only at the five newest models across registered providers, newest gap first", async () => {
    replyWithAnthropicModels([
      modelsDevModel("claude-oldest", "2025-01-01"),
      modelsDevModel("claude-older", "2025-06-01"),
      modelsDevModel("claude-d", "2026-01-01"),
      modelsDevModel("claude-b", "2026-03-01"),
      modelsDevModel(HELD_MODEL_ID, "2026-04-01"),
      modelsDevModel("claude-c", "2026-02-01"),
      modelsDevModel("claude-a", "2026-05-01"),
    ]);

    const response = await listGaps().expect(200);

    expect(
      response.body.gaps.map((gap: { upstreamModelId: string }) => gap.upstreamModelId),
    ).toEqual(["claude-a", "claude-b", "claude-c", "claude-d"]);
  });

  it("checks five models in total, not five per provider", async () => {
    await db.insert(providers).values({
      slug: "deepseek",
      name: "DeepSeek",
      endpoints: [
        { kind: "chat", protocol: "openai-chat", baseUrl: "https://api.deepseek.example" },
      ],
      authStyle: "bearer",
    });
    const asModels = (ids: Array<[string, string]>) => ({
      models: Object.fromEntries(ids.map(([id, date]) => [id, modelsDevModel(id, date)])),
    });
    modelsDev.replyTo("/api.json", {
      kind: "json",
      status: 200,
      body: {
        anthropic: asModels([
          ["claude-1", "2026-11-10"],
          ["claude-2", "2026-11-08"],
          ["claude-3", "2026-11-06"],
        ]),
        deepseek: asModels([
          ["ds-1", "2026-11-09"],
          ["ds-2", "2026-11-07"],
          ["ds-3", "2026-11-05"],
        ]),
      },
    });

    const response = await listGaps().expect(200);

    expect(
      response.body.gaps.map((gap: { upstreamModelId: string }) => gap.upstreamModelId),
    ).toEqual(["claude-1", "ds-1", "claude-2", "ds-2", "claude-3"]);
  });

  it("reads models.dev once, then answers from its cache", async () => {
    replyWithAnthropicModels([modelsDevModel("claude-new", "2026-11-05")]);

    await listGaps().expect(200);
    await listGaps().expect(200);

    expect(modelsDev.requests).toHaveLength(1);
  });

  it("answers no gaps when models.dev cannot be reached", async () => {
    modelsDev.reply({ kind: "reset" });

    const response = await listGaps().expect(200);

    expect(response.body).toEqual({ checkedAt: null, gaps: [] });
  });

  it("does not follow a redirect from models.dev", async () => {
    modelsDev.replyTo("/api.json", {
      kind: "json",
      status: 302,
      body: {},
      headers: { location: "/elsewhere.json" },
    });
    modelsDev.replyTo("/elsewhere.json", {
      kind: "json",
      status: 200,
      body: { anthropic: { models: { "claude-new": modelsDevModel("claude-new", "2026-11-05") } } },
    });

    const response = await listGaps().expect(200);

    expect(response.body).toEqual({ checkedAt: null, gaps: [] });
    expect(modelsDev.requests.map((received) => received.path)).toEqual(["/api.json"]);
  });

  it("rejects a request without a session", async () => {
    await request(app.getHttpServer()).get("/api/catalog/gaps").expect(401);
  });
});
