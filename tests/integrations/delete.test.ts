import { AuthenticationError } from "@nestjs/authentication";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations";
import { apiKeys } from "@/db/schemas";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import { authenticateWithApiKey, createApiKey } from "@tests/support/api-keys";
import { createIntegration } from "@tests/support/integrations";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app";

const ADA = { email: "ada@example.com", password: "ada's password" };
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

describe("Deleting an Integration (e2e)", () => {
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

  async function issueApiKey(integrationId: string): Promise<{ id: string; key: string }> {
    const issued = await createApiKey(app, adaCookie, { name: "customer key" });
    await db
      .update(apiKeys)
      .set({ integrationId, customerId: "customer-42" })
      .where(eq(apiKeys.id, issued.id));
    await app.get(SnapshotService).changed();
    return issued;
  }

  it("revokes the Integration's API Keys, unlinks them, and leaves operator keys alone", async () => {
    const integration = await createIntegration(app, adaCookie);
    const issued = await issueApiKey(integration.id);
    const operatorKey = await createApiKey(app, adaCookie, { name: "CI" });

    await request(app.getHttpServer())
      .delete(`/api/integrations/${integration.id}`)
      .set("Cookie", adaCookie)
      .expect(204);

    const integrations = await request(app.getHttpServer())
      .get("/api/integrations")
      .set("Cookie", adaCookie)
      .expect(200);
    expect(integrations.body).toEqual([]);
    await expect(authenticateWithApiKey(app, issued.key)).rejects.toThrow(AuthenticationError);
    await expect(authenticateWithApiKey(app, operatorKey.key)).resolves.toMatchObject({
      user: { apiKeyId: operatorKey.id },
    });
    const [unlinked] = await db
      .select({
        integrationId: apiKeys.integrationId,
        customerId: apiKeys.customerId,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.id, issued.id));
    expect(unlinked).toEqual({
      integrationId: null,
      customerId: "customer-42",
      revokedAt: expect.any(Date),
    });
  });

  it("answers 404 for an Integration that does not exist", async () => {
    await request(app.getHttpServer())
      .delete(`/api/integrations/${UNKNOWN_ID}`)
      .set("Cookie", adaCookie)
      .expect(404);
  });
});
