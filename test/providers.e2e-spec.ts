import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "../src/db/schemas/relations.js";
import { createTestApp, setUpFirstUser } from "./support/test-app.js";
import { deleteAllUpstreamData, insertRouteTo } from "./support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

// A Provider that ships with no Catalog file but speaks a known Protocol (ADR 0003).
const ACME = {
  slug: "acme",
  name: "Acme AI",
  protocol: "openai-chat",
  baseUrl: "https://api.acme.example/v1",
  authStyle: "bearer",
  quirks: { acceptsCacheControl: true },
};

describe("Providers (e2e)", () => {
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

  async function createAcme(): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/api/providers")
      .set("Cookie", cookie)
      .send(ACME)
      .expect(201);
    return created.body.id;
  }

  it("adds a Provider that speaks a known Protocol and lists it", async () => {
    await createAcme();

    const list = await request(app.getHttpServer())
      .get("/api/providers")
      .set("Cookie", cookie)
      .expect(200);

    expect(list.body).toEqual([
      expect.objectContaining({ ...ACME, isEnabled: true, isFromCatalog: false }),
    ]);
  });

  it("refuses an unknown Protocol or quirk", async () => {
    const server = app.getHttpServer();

    await request(server)
      .post("/api/providers")
      .set("Cookie", cookie)
      .send({ ...ACME, protocol: "openai-responses" })
      .expect(400);
    await request(server)
      .post("/api/providers")
      .set("Cookie", cookie)
      .send({ ...ACME, quirks: { acceptsCacheControll: true } })
      .expect(400);
  });

  it("edits and disables a Provider", async () => {
    const id = await createAcme();

    const updated = await request(app.getHttpServer())
      .patch(`/api/providers/${id}`)
      .set("Cookie", cookie)
      .send({ baseUrl: "https://eu.acme.example/v1", isEnabled: false })
      .expect(200);

    expect(updated.body).toMatchObject({
      slug: ACME.slug,
      baseUrl: "https://eu.acme.example/v1",
      quirks: ACME.quirks,
      isEnabled: false,
    });
  });

  it("deletes a Provider", async () => {
    const server = app.getHttpServer();
    const id = await createAcme();

    await request(server).delete(`/api/providers/${id}`).set("Cookie", cookie).expect(204);

    const list = await request(server).get("/api/providers").set("Cookie", cookie).expect(200);
    expect(list.body).toEqual([]);
  });

  it("refuses to delete a Provider whose Upstream Models have Routes, naming the Models", async () => {
    const server = app.getHttpServer();
    const id = await createAcme();
    const upstreamModel = await request(server)
      .post("/api/upstream-models")
      .set("Cookie", cookie)
      .send({
        providerId: id,
        upstreamModelId: "acme-large",
        capabilities: [],
        contextSize: 128_000,
        maxOutputTokens: null,
        inputPrice: null,
        outputPrice: null,
        cacheReadPrice: null,
        cacheWritePrice: null,
      })
      .expect(201);
    await insertRouteTo(db, upstreamModel.body.id, "smart");

    const refused = await request(server)
      .delete(`/api/providers/${id}`)
      .set("Cookie", cookie)
      .expect(409);

    expect(refused.body.message).toContain("smart");
  });

  it("needs a signed-in User", async () => {
    await request(app.getHttpServer()).get("/api/providers").expect(401);
  });
});
