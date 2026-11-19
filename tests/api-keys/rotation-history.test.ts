import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { createApiKey } from "../support/api-keys.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "../support/test-app.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

describe("An API Key's rotation history (e2e)", () => {
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

  async function rotate(id: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/api-keys/${id}/rotate`)
      .set("Cookie", adaCookie)
      .expect(201);
  }

  function listRotations(id: string): request.Test {
    return request(app.getHttpServer())
      .get(`/api/api-keys/${id}/rotations`)
      .set("Cookie", adaCookie);
  }

  it("is empty for a key that was never rotated", async () => {
    const created = await createApiKey(app, adaCookie);

    const list = await request(app.getHttpServer())
      .get("/api/api-keys")
      .set("Cookie", adaCookie)
      .expect(200);
    const rotations = await listRotations(created.id).expect(200);

    expect(list.body).toMatchObject([{ id: created.id, lastRotatedAt: null }]);
    expect(rotations.body).toEqual([]);
  });

  it("lists each rotation newest first, chained, with who rotated it", async () => {
    const created = await createApiKey(app, adaCookie);
    const originalKeyId = created.key.split("_")[1];
    await rotate(created.id);
    await rotate(created.id);

    const rotations = await listRotations(created.id).expect(200);
    const list = await request(app.getHttpServer())
      .get("/api/api-keys")
      .set("Cookie", adaCookie)
      .expect(200);

    const [latest, first] = rotations.body;
    expect(rotations.body).toHaveLength(2);
    expect(first).toMatchObject({
      previousKeyId: originalKeyId,
      rotatedBy: { id: expect.any(String), email: ADA.email },
    });
    expect(latest.previousKeyId).toBe(first.newKeyId);
    expect(latest.newKeyId).toBe(list.body[0].keyId);
    expect(new Date(latest.rotatedAt) >= new Date(first.rotatedAt)).toBe(true);
    expect(list.body[0].lastRotatedAt).toBe(latest.rotatedAt);
  });

  it("keeps the history of a revoked key", async () => {
    const created = await createApiKey(app, adaCookie);
    await rotate(created.id);
    await request(app.getHttpServer())
      .post(`/api/api-keys/${created.id}/revoke`)
      .set("Cookie", adaCookie)
      .expect(204);

    const rotations = await listRotations(created.id).expect(200);

    expect(rotations.body).toHaveLength(1);
  });

  it("answers 404 for an unknown key", async () => {
    await listRotations(UNKNOWN_ID).expect(404);
  });
});
