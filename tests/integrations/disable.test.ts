import { AuthenticationError } from "@nestjs/authentication";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import {
  authenticateWithIntegrationSecret,
  createIntegration,
} from "@tests/support/integrations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

describe("Disabling and enabling an Integration (e2e)", () => {
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

  async function listIntegrations(): Promise<{ disabledAt: string | null }[]> {
    const list = await request(app.getHttpServer())
      .get("/api/integrations")
      .set("Cookie", adaCookie)
      .expect(200);
    return list.body;
  }

  it("refuses a disabled Integration's secret, and shows when it was disabled", async () => {
    const created = await createIntegration(app, adaCookie);

    await request(app.getHttpServer())
      .post(`/api/integrations/${created.id}/disable`)
      .set("Cookie", adaCookie)
      .expect(204);

    await expect(authenticateWithIntegrationSecret(app, created.secret)).rejects.toThrow(
      AuthenticationError,
    );
    expect(await listIntegrations()).toEqual([
      expect.objectContaining({ disabledAt: expect.any(String) }),
    ]);
  });

  it("lets a re-enabled Integration sign in with the same secret", async () => {
    const created = await createIntegration(app, adaCookie);
    await request(app.getHttpServer())
      .post(`/api/integrations/${created.id}/disable`)
      .set("Cookie", adaCookie)
      .expect(204);

    await request(app.getHttpServer())
      .post(`/api/integrations/${created.id}/enable`)
      .set("Cookie", adaCookie)
      .expect(204);

    await expect(authenticateWithIntegrationSecret(app, created.secret)).resolves.toMatchObject({
      user: { integrationId: created.id },
    });
    expect(await listIntegrations()).toEqual([expect.objectContaining({ disabledAt: null })]);
  });

  it("answers 404 for an Integration that does not exist", async () => {
    await request(app.getHttpServer())
      .post(`/api/integrations/${UNKNOWN_ID}/disable`)
      .set("Cookie", adaCookie)
      .expect(404);
  });
});
