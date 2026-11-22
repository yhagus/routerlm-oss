import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

const ACME = {
  slug: "acme",
  name: "Acme AI",
  endpoints: [{ kind: "chat", protocol: "openai-chat", baseUrl: "https://api.acme.example/v1" }],
  authStyle: "bearer",
};

describe("A Provider's logo and quota reader (e2e)", () => {
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

  it("stores a logo and a quota reader, and clears both", async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post("/api/providers")
      .set("Cookie", cookie)
      .send({ ...ACME, logo: "acme-ai", quotaReader: "kimi-code" })
      .expect(201);
    expect(created.body).toMatchObject({ logo: "acme-ai", quotaReader: "kimi-code" });

    const cleared = await request(server)
      .patch(`/api/providers/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ logo: null, quotaReader: null })
      .expect(200);

    expect(cleared.body).toMatchObject({ logo: null, quotaReader: null });
  });

  it("refuses a logo that isn't a lowercase key", async () => {
    await request(app.getHttpServer())
      .post("/api/providers")
      .set("Cookie", cookie)
      .send({ ...ACME, logo: "Acme AI.svg" })
      .expect(400);
  });
});
