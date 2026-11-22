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

describe("Editing an Integration (e2e)", () => {
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

  it("renames an Integration and restricts its Models, keeping its secret working", async () => {
    const [model] = await db.insert(models).values({ name: "smart" }).returning();
    const created = await createIntegration(app, adaCookie);

    const edited = await request(app.getHttpServer())
      .patch(`/api/integrations/${created.id}`)
      .set("Cookie", adaCookie)
      .send({ name: "Acme Cloud", allowedModelIds: [model.id] })
      .expect(200);

    expect(edited.body).toMatchObject({
      id: created.id,
      name: "Acme Cloud",
      allowedModels: [{ id: model.id, name: "smart" }],
    });
    await expect(authenticateWithIntegrationSecret(app, created.secret)).resolves.toMatchObject({
      user: { integrationName: "Acme Cloud", allowedModelIds: [model.id] },
    });
  });

  it("opens an Integration to every Model with an empty list", async () => {
    const [model] = await db.insert(models).values({ name: "smart" }).returning();
    const created = await createIntegration(app, adaCookie, {
      name: "Acme SaaS",
      allowedModelIds: [model.id],
    });

    const edited = await request(app.getHttpServer())
      .patch(`/api/integrations/${created.id}`)
      .set("Cookie", adaCookie)
      .send({ allowedModelIds: [] })
      .expect(200);

    expect(edited.body).toMatchObject({ name: "Acme SaaS", allowedModels: [] });
  });

  it("rejects an allowed Model that does not exist", async () => {
    const created = await createIntegration(app, adaCookie);

    await request(app.getHttpServer())
      .patch(`/api/integrations/${created.id}`)
      .set("Cookie", adaCookie)
      .send({ allowedModelIds: [UNKNOWN_ID] })
      .expect(400);
  });

  it("answers 404 for an Integration that does not exist", async () => {
    await request(app.getHttpServer())
      .patch(`/api/integrations/${UNKNOWN_ID}`)
      .set("Cookie", adaCookie)
      .send({ name: "Acme Cloud" })
      .expect(404);
  });
});
