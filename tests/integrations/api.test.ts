import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { models } from "@/db/schemas/index.js";
import {
  authenticateWithIntegrationSecret,
  createIntegration,
} from "@tests/support/integrations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

describe("Integrations (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table integrations, api_keys, models cascade`);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  it("shows a new Integration Secret once, and lists the Integration without it or its hash", async () => {
    const server = app.getHttpServer();
    const [model] = await db.insert(models).values({ name: "smart" }).returning();

    const created = await request(server)
      .post("/api/integrations")
      .set("Cookie", adaCookie)
      .send({ name: "Acme SaaS", allowedModelIds: [model.id] })
      .expect(201);
    const list = await request(server)
      .get("/api/integrations")
      .set("Cookie", adaCookie)
      .expect(200);

    expect(created.body.secret).toMatch(/^rlmi_[0-9a-f]{16}_\S+$/);
    expect(list.body).toEqual([
      {
        id: created.body.id,
        name: "Acme SaaS",
        keyId: created.body.secret.split("_")[1],
        createdBy: { id: expect.any(String), email: ADA.email },
        createdAt: expect.any(String),
        disabledAt: null,
        allowedModels: [{ id: model.id, name: "smart" }],
        lastRotatedAt: null,
        lastUsedAt: null,
      },
    ]);
  });

  it("signs an Integration in with its secret, as that Integration", async () => {
    const created = await createIntegration(app, adaCookie);

    await expect(authenticateWithIntegrationSecret(app, created.secret)).resolves.toMatchObject({
      user: { integrationId: created.id, integrationName: "Acme SaaS", allowedModelIds: [] },
    });
  });

  it("never lets an Integration Secret call inference", async () => {
    const created = await createIntegration(app, adaCookie);

    await request(app.getHttpServer())
      .get("/v1/models")
      .set("Authorization", `Bearer ${created.secret}`)
      .expect(401);
  });

  it("lets only a User's session manage Integrations, never an Integration Secret", async () => {
    const created = await createIntegration(app, adaCookie);

    await request(app.getHttpServer())
      .get("/api/integrations")
      .set("Authorization", `Bearer ${created.secret}`)
      .expect(401);
  });

  it("rejects an allowed Model that does not exist", async () => {
    await request(app.getHttpServer())
      .post("/api/integrations")
      .set("Cookie", adaCookie)
      .send({ name: "Acme SaaS", allowedModelIds: [UNKNOWN_ID] })
      .expect(400);
  });
});
