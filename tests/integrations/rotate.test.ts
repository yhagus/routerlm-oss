import { AuthenticationError } from "@nestjs/authentication";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations";
import { authenticateWithIntegrationSecret, createIntegration } from "@tests/support/integrations";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app";

const ADA = { email: "ada@example.com", password: "ada's password" };
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

describe("Rotating an Integration Secret (e2e)", () => {
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

  it("returns a new secret that signs in, refuses the old one, and records the rotation", async () => {
    const created = await createIntegration(app, adaCookie);

    const rotated = await request(app.getHttpServer())
      .post(`/api/integrations/${created.id}/rotate`)
      .set("Cookie", adaCookie)
      .expect(201);
    const list = await request(app.getHttpServer())
      .get("/api/integrations")
      .set("Cookie", adaCookie)
      .expect(200);

    expect(rotated.body).toMatchObject({ id: created.id, name: "Acme SaaS" });
    expect(rotated.body.secret).not.toBe(created.secret);
    await expect(
      authenticateWithIntegrationSecret(app, rotated.body.secret),
    ).resolves.toMatchObject({ user: { integrationId: created.id } });
    await expect(authenticateWithIntegrationSecret(app, created.secret)).rejects.toThrow(
      AuthenticationError,
    );
    expect(list.body).toEqual([
      expect.objectContaining({
        keyId: rotated.body.secret.split("_")[1],
        lastRotatedAt: expect.any(String),
      }),
    ]);
  });

  it("answers 404 for an Integration that does not exist", async () => {
    await request(app.getHttpServer())
      .post(`/api/integrations/${UNKNOWN_ID}/rotate`)
      .set("Cookie", adaCookie)
      .expect(404);
  });
});
