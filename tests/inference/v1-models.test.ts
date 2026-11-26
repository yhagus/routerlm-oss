import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations";
import { models } from "@/db/schemas";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import { ALL_CAPABILITIES, insertApiKey, insertOpenAiChatModel } from "@tests/support/inference";
import { createTestApp } from "@tests/support/test-app";
import { deleteAllUpstreamData } from "@tests/support/upstream";

describe("GET /v1/models (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists only the enabled Models the key may use, with their Capabilities and nothing about Routes", async () => {
    const smart = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: "http://upstream.invalid/v1",
    });
    const retired = await insertOpenAiChatModel(app, db, {
      modelName: "retired",
      baseUrl: "http://upstream.invalid/v1",
    });
    await insertOpenAiChatModel(app, db, {
      modelName: "not-allowed",
      baseUrl: "http://upstream.invalid/v1",
    });
    await db.update(models).set({ isEnabled: false }).where(eq(models.id, retired.modelId));
    await app.get(SnapshotService).changed();
    const { key } = await insertApiKey(app, db, [smart.modelId, retired.modelId]);

    const response = await request(app.getHttpServer())
      .get("/v1/models")
      .set("x-api-key", key)
      .expect(200);

    expect(response.body).toEqual({
      object: "list",
      data: [
        {
          id: "smart",
          object: "model",
          created: expect.any(Number),
          owned_by: "routerlm",
          kind: "chat",
          capabilities: ALL_CAPABILITIES,
        },
      ],
    });
  });

  it("refuses a request without an API Key", async () => {
    const response = await request(app.getHttpServer()).get("/v1/models").expect(401);

    expect(response.body.error.code).toBe("invalid_api_key");
  });
});
