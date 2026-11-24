import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { upstreamModels } from "@/db/schemas/index.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

describe("Models (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createModel(name: string, kind?: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/api/models")
      .set("Cookie", cookie)
      .send({ name, kind })
      .expect(201);
    return created.body.id;
  }

  async function createUpstreamModel(
    providerSlug: string,
    upstreamModelId: string,
    capabilities: string[],
  ): Promise<{ providerId: string; upstreamModelId: string }> {
    const server = app.getHttpServer();
    const provider = await request(server)
      .post("/api/providers")
      .set("Cookie", cookie)
      .send({
        slug: providerSlug,
        name: `${providerSlug} AI`,
        endpoints: [
          { kind: "chat", protocol: "openai-chat", baseUrl: `https://api.${providerSlug}.example` },
        ],
        authStyle: "bearer",
      })
      .expect(201);
    const upstreamModel = await request(server)
      .post("/api/upstream-models")
      .set("Cookie", cookie)
      .send({
        providerId: provider.body.id,
        upstreamModelId,
        capabilities,
        contextSize: 128_000,
        maxOutputTokens: null,
        inputPrice: null,
        outputPrice: null,
        cacheReadPrice: null,
        cacheWritePrice: null,
      })
      .expect(201);
    return { providerId: provider.body.id, upstreamModelId: upstreamModel.body.id };
  }

  async function addProviderAccount(providerId: string, isEnabled: boolean): Promise<void> {
    await request(app.getHttpServer())
      .post("/api/provider-accounts")
      .set("Cookie", cookie)
      .send({ providerId, name: "main", key: "sk-test-0123456789", isEnabled })
      .expect(201);
  }

  async function addRoute(modelId: string, upstreamModelId: string): Promise<string> {
    const model = await request(app.getHttpServer())
      .post(`/api/models/${modelId}/routes`)
      .set("Cookie", cookie)
      .send({ upstreamModelId })
      .expect(201);
    return model.body.routes.at(-1).id;
  }

  it("shows each Route's Provider, Upstream Model, Capabilities and enabled Provider Accounts", async () => {
    const acme = await createUpstreamModel("acme", "acme-large", ["vision", "tools"]);
    const zeta = await createUpstreamModel("zeta", "zeta-mini", ["reasoning"]);
    await addProviderAccount(acme.providerId, true);
    await addProviderAccount(acme.providerId, true);
    await addProviderAccount(zeta.providerId, false);
    const modelId = await createModel("smart");
    await addRoute(modelId, acme.upstreamModelId);
    await addRoute(modelId, zeta.upstreamModelId);

    const model = await request(app.getHttpServer())
      .get(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .expect(200);

    expect(model.body).toMatchObject({
      name: "smart",
      routes: [
        {
          isEnabled: true,
          provider: { id: acme.providerId, name: "acme AI" },
          upstreamModel: { upstreamModelId: "acme-large", capabilities: ["vision", "tools"] },
          enabledProviderAccountCount: 2,
        },
        {
          provider: { id: zeta.providerId, name: "zeta AI" },
          upstreamModel: { upstreamModelId: "zeta-mini", capabilities: ["reasoning"] },
          enabledProviderAccountCount: 0,
        },
      ],
    });
  });

  it("saves a new Route order as priority, first listed first", async () => {
    const acme = await createUpstreamModel("acme", "acme-large", []);
    const zeta = await createUpstreamModel("zeta", "zeta-mini", []);
    const modelId = await createModel("smart");
    const acmeRouteId = await addRoute(modelId, acme.upstreamModelId);
    const zetaRouteId = await addRoute(modelId, zeta.upstreamModelId);

    await request(app.getHttpServer())
      .put(`/api/models/${modelId}/route-order`)
      .set("Cookie", cookie)
      .send({ routeIds: [zetaRouteId, acmeRouteId] })
      .expect(200);

    const model = await request(app.getHttpServer())
      .get(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(model.body.routes).toMatchObject([
      { id: zetaRouteId, priority: 0 },
      { id: acmeRouteId, priority: 1 },
    ]);
  });

  it("overrides a Route's timeouts, and clears an override back to the gateway default", async () => {
    const acme = await createUpstreamModel("acme", "acme-large", []);
    const modelId = await createModel("smart");
    const routeId = await addRoute(modelId, acme.upstreamModelId);
    const routeUrl = `/api/models/${modelId}/routes/${routeId}`;

    await request(app.getHttpServer())
      .patch(routeUrl)
      .set("Cookie", cookie)
      .send({ connectTimeoutMs: 2000, firstTokenTimeoutMs: 30_000, totalTimeoutMs: 120_000 })
      .expect(200);
    const model = await request(app.getHttpServer())
      .patch(routeUrl)
      .set("Cookie", cookie)
      .send({ firstTokenTimeoutMs: null })
      .expect(200);

    expect(model.body.routes[0]).toMatchObject({
      connectTimeoutMs: 2000,
      firstTokenTimeoutMs: null,
      totalTimeoutMs: 120_000,
    });
  });

  it("refuses a Route order that leaves out one of the Model's Routes", async () => {
    const acme = await createUpstreamModel("acme", "acme-large", []);
    const modelId = await createModel("smart");
    const acmeRouteId = await addRoute(modelId, acme.upstreamModelId);
    await addRoute(modelId, acme.upstreamModelId);

    await request(app.getHttpServer())
      .put(`/api/models/${modelId}/route-order`)
      .set("Cookie", cookie)
      .send({ routeIds: [acmeRouteId] })
      .expect(400);
  });

  it("refuses a Route to an Upstream Model that does not exist", async () => {
    const modelId = await createModel("smart");

    await request(app.getHttpServer())
      .post(`/api/models/${modelId}/routes`)
      .set("Cookie", cookie)
      .send({ upstreamModelId: "00000000-0000-4000-8000-000000000000" })
      .expect(404);
  });

  it("creates a Model under the name clients will send, and lists it", async () => {
    await createModel("smart");

    const list = await request(app.getHttpServer())
      .get("/api/models")
      .set("Cookie", cookie)
      .expect(200);

    expect(list.body).toEqual([
      expect.objectContaining({ name: "smart", kind: "chat", isEnabled: true, routeCount: 0 }),
    ]);
  });

  it("creates a Model of the Kind it is given", async () => {
    const modelId = await createModel("painter", "image");

    const model = await request(app.getHttpServer())
      .get(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .expect(200);

    expect(model.body.kind).toBe("image");
  });

  it("refuses a Route to an Upstream Model of another Kind, naming both Kinds", async () => {
    const modelId = await createModel("painter", "image");
    const { upstreamModelId } = await createUpstreamModel("acme", "acme-large", []);

    const response = await request(app.getHttpServer())
      .post(`/api/models/${modelId}/routes`)
      .set("Cookie", cookie)
      .send({ upstreamModelId })
      .expect(400);

    expect(response.body.message).toBe(
      'The Upstream Model "acme-large" has the Kind chat, but the Model "painter" has the Kind image',
    );
  });

  it("refuses to point a Route at an Upstream Model of another Kind", async () => {
    const modelId = await createModel("smart");
    const { providerId, upstreamModelId } = await createUpstreamModel("acme", "acme-large", []);
    const routeId = await addRoute(modelId, upstreamModelId);
    const [painter] = await db
      .insert(upstreamModels)
      .values({ providerId, upstreamModelId: "acme-paint", kind: "image", contextSize: 1 })
      .returning({ id: upstreamModels.id });

    await request(app.getHttpServer())
      .patch(`/api/models/${modelId}/routes/${routeId}`)
      .set("Cookie", cookie)
      .send({ upstreamModelId: painter.id })
      .expect(400);
  });

  it("refuses a second Model with the same name, saying why", async () => {
    await createModel("smart");

    const refused = await request(app.getHttpServer())
      .post("/api/models")
      .set("Cookie", cookie)
      .send({ name: "smart" })
      .expect(409);

    expect(refused.body.message).toBe('A Model named "smart" already exists');
  });

  it("accepts and returns a thinking budget cap", async () => {
    const modelId = await createModel("smart");

    const saved = await request(app.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .send({ parameterPolicy: { caps: { reasoningBudgetTokens: 2048 } } })
      .expect(200);

    expect(saved.body.parameterPolicy).toEqual({ caps: { reasoningBudgetTokens: 2048 } });
  });

  it("refuses a Parameter Policy whose default is above its cap, saying which", async () => {
    const modelId = await createModel("smart");

    const refused = await request(app.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .send({
        parameterPolicy: { defaults: { maxOutputTokens: 8192 }, caps: { maxOutputTokens: 4096 } },
      })
      .expect(400);

    expect(refused.body.message).toEqual([
      expect.stringContaining("The default maxOutputTokens (8192) is above its cap (4096)"),
    ]);
  });

  it("refuses a Parameter Policy whose forced reasoning effort is above its cap, saying which", async () => {
    const modelId = await createModel("smart");

    const refused = await request(app.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .send({
        parameterPolicy: {
          forced: { reasoningEffort: "high" },
          caps: { reasoningEffort: "medium" },
        },
      })
      .expect(400);

    expect(refused.body.message).toEqual([
      expect.stringContaining("The forced reasoningEffort (high) is above its cap (medium)"),
    ]);
  });

  it("refuses a Parameter Policy naming a parameter it does not know", async () => {
    const modelId = await createModel("smart");

    const refused = await request(app.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .send({ parameterPolicy: { defaults: { frequencyPenalty: 0.5 } } })
      .expect(400);

    expect(refused.body.message).toEqual([
      'parameterPolicy.defaults: Unrecognized key: "frequencyPenalty"',
    ]);
  });

  it("refuses to list Models without a signed-in User", async () => {
    await request(app.getHttpServer()).get("/api/models").expect(401);
  });
});
