import { AuthenticationError } from "@nestjs/authentication";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";
import { authenticateWithApiKey, createApiKey } from "../support/api-keys.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "../support/test-app.js";

const ADA = { email: "ada@example.com", password: "ada's password" };

describe("Rotating an API Key (e2e)", () => {
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

  it("returns a new key on the same row that signs in, and refuses the old key", async () => {
    const created = await createApiKey(app, adaCookie, {
      name: "CI",
      expiresAt: "2999-01-01T00:00:00.000Z",
    });

    const rotated = await request(app.getHttpServer())
      .post(`/api/api-keys/${created.id}/rotate`)
      .set("Cookie", adaCookie)
      .expect(201);

    expect(rotated.body).toMatchObject({
      id: created.id,
      name: "CI",
      expiresAt: "2999-01-01T00:00:00.000Z",
      isCopyable: true,
    });
    expect(rotated.body.key).not.toBe(created.key);
    await expect(authenticateWithApiKey(app, rotated.body.key)).resolves.toMatchObject({
      user: { apiKeyId: created.id },
    });
    await expect(authenticateWithApiKey(app, created.key)).rejects.toThrow(AuthenticationError);
  });

  it("makes a key created before keys were kept copyable", async () => {
    const created = await createApiKey(app, adaCookie);
    await db.update(apiKeys).set({ encryptedKey: null }).where(eq(apiKeys.id, created.id));

    const rotated = await request(app.getHttpServer())
      .post(`/api/api-keys/${created.id}/rotate`)
      .set("Cookie", adaCookie)
      .expect(201);
    const copied = await request(app.getHttpServer())
      .get(`/api/api-keys/${created.id}/key`)
      .set("Cookie", adaCookie)
      .expect(200);

    expect(copied.body).toEqual({ key: rotated.body.key });
  });

  it("refuses to rotate a revoked key", async () => {
    const created = await createApiKey(app, adaCookie);
    await request(app.getHttpServer())
      .post(`/api/api-keys/${created.id}/revoke`)
      .set("Cookie", adaCookie)
      .expect(204);

    const rotated = await request(app.getHttpServer())
      .post(`/api/api-keys/${created.id}/rotate`)
      .set("Cookie", adaCookie)
      .expect(409);

    expect(rotated.body.message).toBe("A revoked API Key can't be rotated.");
  });

  it("answers 404 for a key that does not exist", async () => {
    await request(app.getHttpServer())
      .post("/api/api-keys/00000000-0000-4000-8000-000000000000/rotate")
      .set("Cookie", adaCookie)
      .expect(404);
  });
});
