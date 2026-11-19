import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { createTestApp, setUpFirstUser } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

const MODEL = {
  upstreamModelId: "acme-large",
  capabilities: [],
  contextSize: 100_000,
  maxOutputTokens: null,
  inputPrice: 1,
  outputPrice: 2,
  cacheReadPrice: null,
  cacheWritePrice: null,
};
const FAST_PRICES = { fast: { inputPrice: 2, outputPrice: 4 } };

describe("Upstream Model Service Tier rules (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;
  let tieredProviderId: string;
  let plainProviderId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    const base = {
      endpoints: [
        { kind: "chat", protocol: "openai-chat", baseUrl: "https://api.acme.example/v1" },
      ],
      authStyle: "bearer",
    };
    tieredProviderId = (
      await post("/api/providers", {
        ...base,
        slug: "tiered",
        name: "Tiered",
        serviceTierValues: { fast: "priority" },
      }).expect(201)
    ).body.id;
    plainProviderId = (
      await post("/api/providers", { ...base, slug: "plain", name: "Plain" }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, body: object) =>
    request(app.getHttpServer()).post(path).set("Cookie", cookie).send(body);
  const patch = (path: string, body: object) =>
    request(app.getHttpServer()).patch(path).set("Cookie", cookie).send(body);

  it("lists a tier the Provider maps, with its prices", async () => {
    const created = await post("/api/upstream-models", {
      ...MODEL,
      providerId: tieredProviderId,
      serviceTiers: ["fast"],
      tierPrices: FAST_PRICES,
    }).expect(201);

    expect(created.body).toMatchObject({ serviceTiers: ["fast"], tierPrices: FAST_PRICES });
  });

  it("refuses a tier the Provider maps to no wire value, on create and on edit", async () => {
    const refused = await post("/api/upstream-models", {
      ...MODEL,
      providerId: plainProviderId,
      serviceTiers: ["fast"],
    }).expect(400);
    expect(refused.body.message).toContain("fast");

    const { body } = await post("/api/upstream-models", {
      ...MODEL,
      providerId: tieredProviderId,
    }).expect(201);
    await patch(`/api/upstream-models/${body.id}`, { serviceTiers: ["flex"] }).expect(400);
    await patch(`/api/upstream-models/${body.id}`, { serviceTiers: ["fast"] }).expect(200);
  });

  it("refuses prices for a tier the model does not list, on create and on edit", async () => {
    const refused = await post("/api/upstream-models", {
      ...MODEL,
      providerId: tieredProviderId,
      tierPrices: FAST_PRICES,
    }).expect(400);
    expect(refused.body.message).toContain("fast");

    const { body } = await post("/api/upstream-models", {
      ...MODEL,
      providerId: tieredProviderId,
      serviceTiers: ["fast"],
      tierPrices: FAST_PRICES,
    }).expect(201);
    await patch(`/api/upstream-models/${body.id}`, { serviceTiers: [] }).expect(400);
    await patch(`/api/upstream-models/${body.id}`, { serviceTiers: [], tierPrices: {} }).expect(
      200,
    );
  });

  it("answers 404 for a Provider that does not exist", async () => {
    await post("/api/upstream-models", {
      ...MODEL,
      providerId: "00000000-0000-4000-8000-000000000000",
    }).expect(404);
  });
});
