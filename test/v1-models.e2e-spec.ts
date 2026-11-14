import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "../src/db/relations.js";
import { models } from "../src/db/schema.js";
import { SnapshotService } from "../src/snapshot/snapshot.service.js";
import { ALL_CAPABILITIES, insertApiKey, insertOpenAiChatModel } from "./support/inference.js";
import { createTestApp } from "./support/test-app.js";
import { deleteAllUpstreamData } from "./support/upstream.js";

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

    // Anthropic-style clients send the key as x-api-key.
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
