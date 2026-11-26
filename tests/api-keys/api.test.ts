import { AuthenticationError } from "@nestjs/authentication";
import { ExecutionContextHost } from "@nestjs/core/helpers/execution-context-host";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth";
import type { Database } from "@/db/schemas/relations";
import { apiKeys, models } from "@/db/schemas";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app";

const ADA = { email: "ada@example.com", password: "ada's password" };

describe("API Keys (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table api_keys, models cascade`);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  it("shows a new key once, and lists it without the key or its hash", async () => {
    const server = app.getHttpServer();
    const [model] = await db.insert(models).values({ name: "smart" }).returning();

    const created = await request(server)
      .post("/api/api-keys")
      .set("Cookie", adaCookie)
      .send({ name: "CI", expiresAt: "2999-01-01T00:00:00.000Z", allowedModelIds: [model.id] })
      .expect(201);
    const list = await request(server).get("/api/api-keys").set("Cookie", adaCookie).expect(200);

    expect(created.body.key).toMatch(/^rlm_[0-9a-f]{16}_\S+$/);
    expect(list.body).toEqual([
      {
        id: created.body.id,
        name: "CI",
        keyId: created.body.key.split("_")[1],
        createdBy: { id: expect.any(String), email: ADA.email },
        createdAt: expect.any(String),
        expiresAt: "2999-01-01T00:00:00.000Z",
        revokedAt: null,
        allowedModels: [{ id: model.id, name: "smart" }],
        isCopyable: true,
        lastRotatedAt: null,
        integration: null,
        customerId: null,
        spendLimit: null,
        spent: 0,
        requestRate: null,
      },
    ]);
  });

  async function createKey(): Promise<{ id: string; key: string }> {
    const created = await request(app.getHttpServer())
      .post("/api/api-keys")
      .set("Cookie", adaCookie)
      .send({ name: "CI" })
      .expect(201);
    return created.body;
  }

  function authenticateWith(key: string): Promise<unknown> {
    const httpRequest = { headers: { authorization: `Bearer ${key}` } };
    return app.get(ApiKeyAuth).authenticate(new ExecutionContextHost([httpRequest]));
  }

  it("signs a client in with a new key, as that key", async () => {
    const created = await createKey();

    await expect(authenticateWith(created.key)).resolves.toMatchObject({
      user: { apiKeyId: created.id, allowedModelIds: [] },
    });
  });

  it("refuses a key from the moment it is revoked", async () => {
    const created = await createKey();

    await request(app.getHttpServer())
      .post(`/api/api-keys/${created.id}/revoke`)
      .set("Cookie", adaCookie)
      .expect(204);

    await expect(authenticateWith(created.key)).rejects.toThrow(AuthenticationError);
  });

  it("refuses a key once it has expired", async () => {
    const created = await createKey();
    await db
      .update(apiKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiKeys.id, created.id));
    await app.get(SnapshotService).changed();

    await expect(authenticateWith(created.key)).rejects.toThrow("api key expired");
  });

  it("lets only a User's session manage API Keys, never an API Key", async () => {
    const created = await createKey();

    await request(app.getHttpServer())
      .get("/api/api-keys")
      .set("Authorization", `Bearer ${created.key}`)
      .expect(401);
  });

  it("rejects an expiry in the past", async () => {
    await request(app.getHttpServer())
      .post("/api/api-keys")
      .set("Cookie", adaCookie)
      .send({ name: "CI", expiresAt: "2000-01-01T00:00:00.000Z" })
      .expect(400);
  });

  it("rejects an allowed Model that does not exist", async () => {
    await request(app.getHttpServer())
      .post("/api/api-keys")
      .set("Cookie", adaCookie)
      .send({ name: "CI", allowedModelIds: ["00000000-0000-4000-8000-000000000000"] })
      .expect(400);
  });

  it("takes a Spend Limit to 10 decimal places, as stored, and refuses one it would round", async () => {
    const create = (spendLimit: number) =>
      request(app.getHttpServer())
        .post("/api/api-keys")
        .set("Cookie", adaCookie)
        .send({ name: "CI", spendLimit });

    await create(0.1234567891).expect(201);
    await create(0.12345678912).expect(400);

    const list = await request(app.getHttpServer())
      .get("/api/api-keys")
      .set("Cookie", adaCookie)
      .expect(200);
    expect(list.body).toEqual([expect.objectContaining({ spendLimit: 0.1234567891 })]);
  });
});
