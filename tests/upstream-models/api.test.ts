import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { createTestApp, setUpFirstUser } from "../support/test-app.js";
import { deleteAllUpstreamData, insertRouteTo } from "../support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

const ACME_LARGE = {
  upstreamModelId: "acme-large",
  name: "Acme Large",
  capabilities: ["vision", "tools"],
  contextSize: 200_000,
  maxOutputTokens: 32_000,
  inputPrice: 3,
  outputPrice: 15,
  cacheReadPrice: 0.3,
  cacheWritePrice: 3.75,
  releaseDate: "2026-02-10",
};

describe("Upstream Models (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    const provider = await request(app.getHttpServer())
      .post("/api/providers")
      .set("Cookie", cookie)
      .send({
        slug: "acme",
        name: "Acme AI",
        endpoints: [
          { kind: "chat", protocol: "anthropic-messages", baseUrl: "https://api.acme.example" },
        ],
        authStyle: "x-api-key",
      })
      .expect(201);
    providerId = provider.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAcmeLarge(): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/api/upstream-models")
      .set("Cookie", cookie)
      .send({ providerId, ...ACME_LARGE })
      .expect(201);
    return created.body.id;
  }

  it("adds an Upstream Model with Capabilities, limits and prices, and lists it", async () => {
    await createAcmeLarge();

    const list = await request(app.getHttpServer())
      .get("/api/upstream-models")
      .set("Cookie", cookie)
      .expect(200);

    expect(list.body).toEqual([
      expect.objectContaining({ providerId, ...ACME_LARGE, isEnabled: true }),
    ]);
  });

  it("edits Capabilities and prices, and clears a price the Provider stopped publishing", async () => {
    const id = await createAcmeLarge();

    const updated = await request(app.getHttpServer())
      .patch(`/api/upstream-models/${id}`)
      .set("Cookie", cookie)
      .send({ capabilities: ["reasoning"], outputPrice: 12.5, cacheWritePrice: null })
      .expect(200);

    expect(updated.body).toMatchObject({
      capabilities: ["reasoning"],
      inputPrice: 3,
      outputPrice: 12.5,
      cacheWritePrice: null,
    });
  });

  it("changes and clears the Release Date", async () => {
    const server = app.getHttpServer();
    const id = await createAcmeLarge();

    const changed = await request(server)
      .patch(`/api/upstream-models/${id}`)
      .set("Cookie", cookie)
      .send({ releaseDate: "2026-02-12" })
      .expect(200);
    const cleared = await request(server)
      .patch(`/api/upstream-models/${id}`)
      .set("Cookie", cookie)
      .send({ releaseDate: null })
      .expect(200);

    expect(changed.body.releaseDate).toBe("2026-02-12");
    expect(cleared.body.releaseDate).toBeNull();
  });

  it("changes and clears the name", async () => {
    const server = app.getHttpServer();
    const id = await createAcmeLarge();

    const changed = await request(server)
      .patch(`/api/upstream-models/${id}`)
      .set("Cookie", cookie)
      .send({ name: "Acme Large 2" })
      .expect(200);
    const cleared = await request(server)
      .patch(`/api/upstream-models/${id}`)
      .set("Cookie", cookie)
      .send({ name: null })
      .expect(200);

    expect(changed.body.name).toBe("Acme Large 2");
    expect(cleared.body.name).toBeNull();
  });

  it("adds an Upstream Model without a Release Date", async () => {
    const { releaseDate: _omitted, ...withoutReleaseDate } = ACME_LARGE;

    const created = await request(app.getHttpServer())
      .post("/api/upstream-models")
      .set("Cookie", cookie)
      .send({ providerId, ...withoutReleaseDate })
      .expect(201);

    expect(created.body.releaseDate).toBeNull();
  });

  it("refuses a Release Date that isn't YYYY-MM-DD", async () => {
    await request(app.getHttpServer())
      .post("/api/upstream-models")
      .set("Cookie", cookie)
      .send({ providerId, ...ACME_LARGE, releaseDate: "2026/01/01" })
      .expect(400);
  });

  it("refuses a second Upstream Model with the same name at one Provider", async () => {
    await createAcmeLarge();

    await request(app.getHttpServer())
      .post("/api/upstream-models")
      .set("Cookie", cookie)
      .send({ providerId, ...ACME_LARGE })
      .expect(409);
  });

  it("refuses to delete an Upstream Model a Route uses, naming the Model", async () => {
    const server = app.getHttpServer();
    const id = await createAcmeLarge();
    await insertRouteTo(db, id, "smart");

    const refused = await request(server)
      .delete(`/api/upstream-models/${id}`)
      .set("Cookie", cookie)
      .expect(409);

    expect(refused.body.message).toContain("smart");
  });
});
