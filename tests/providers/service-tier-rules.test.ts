import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

const ANTHROPIC_ENDPOINTS = [
  { kind: "chat", protocol: "anthropic-messages", baseUrl: "https://api.acme.example/v1" },
];
const RESPONSES_ENDPOINTS = [
  { kind: "chat", protocol: "openai-responses", baseUrl: "https://api.acme.example/v1" },
];

const ACME = {
  slug: "acme",
  name: "Acme AI",
  endpoints: [{ kind: "chat", protocol: "openai-chat", baseUrl: "https://api.acme.example/v1" }],
  authStyle: "bearer",
};
const TIER_VALUES = { fast: "priority", flex: "flex" };

describe("Provider Service Tier rules (e2e)", () => {
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

  const post = (path: string, body: object) =>
    request(app.getHttpServer()).post(path).set("Cookie", cookie).send(body);
  const patch = (path: string, body: object) =>
    request(app.getHttpServer()).patch(path).set("Cookie", cookie).send(body);

  it("lets a Provider on a Protocol that sends a tier map Service Tiers", async () => {
    const chat = await post("/api/providers", { ...ACME, serviceTierValues: TIER_VALUES });
    const responses = await post("/api/providers", {
      ...ACME,
      slug: "acme-responses",
      endpoints: RESPONSES_ENDPOINTS,
      serviceTierValues: TIER_VALUES,
    });

    expect([chat.status, responses.status]).toEqual([201, 201]);
    expect(chat.body.serviceTierValues).toEqual(TIER_VALUES);
  });

  it("refuses Service Tiers on a Protocol that never sends one, naming them", async () => {
    const created = await post("/api/providers", {
      ...ACME,
      endpoints: ANTHROPIC_ENDPOINTS,
      authStyle: "x-api-key",
      serviceTierValues: { fast: "priority" },
    }).expect(400);

    expect(created.body.message).toContain("fast");
    expect(created.body.message).toContain("anthropic-messages");
  });

  it("refuses a change of Protocol that would leave Service Tiers on a Protocol that never sends one", async () => {
    const { body } = await post("/api/providers", {
      ...ACME,
      serviceTierValues: TIER_VALUES,
    }).expect(201);

    await patch(`/api/providers/${body.id}`, {
      endpoints: ANTHROPIC_ENDPOINTS,
      quirks: {},
    }).expect(400);
    await patch(`/api/providers/${body.id}`, {
      endpoints: ANTHROPIC_ENDPOINTS,
      quirks: {},
      serviceTierValues: {},
    }).expect(200);
  });

  it("refuses to stop mapping a tier an Upstream Model lists, naming the Model", async () => {
    const { body } = await post("/api/providers", {
      ...ACME,
      serviceTierValues: TIER_VALUES,
    }).expect(201);
    await post("/api/upstream-models", {
      providerId: body.id,
      upstreamModelId: "acme-large",
      capabilities: [],
      contextSize: 100_000,
      maxOutputTokens: null,
      inputPrice: 1,
      outputPrice: 2,
      cacheReadPrice: null,
      cacheWritePrice: null,
      serviceTiers: ["fast"],
    }).expect(201);

    const refused = await patch(`/api/providers/${body.id}`, {
      serviceTierValues: { flex: "flex" },
    }).expect(409);
    expect(refused.body.message).toContain("acme-large");

    await patch(`/api/providers/${body.id}`, { serviceTierValues: { fast: "priority" } }).expect(
      200,
    );
  });
});
