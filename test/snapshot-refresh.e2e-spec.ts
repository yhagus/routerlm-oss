import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { insertApiKey, insertOpenAiChatModel } from "./support/inference.js";
import { createTestApp, setUpFirstUser } from "./support/test-app.js";
import { deleteAllUpstreamData } from "./support/upstream.js";

// Spec "Inference path": a dashboard change takes effect within about a second.
const PROPAGATION_LIMIT_MS = 1000;
const POLL_INTERVAL_MS = 50;

/** Retries `check` until it passes or the propagation limit is over. */
async function eventually(check: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + PROPAGATION_LIMIT_MS;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

describe("Snapshot refresh across backend instances (e2e)", () => {
  // Two backend instances sharing PostgreSQL and Redis: the dashboard writes
  // through one, clients call the other.
  let dashboardInstance: NestNodeApplication;
  let inferenceInstance: NestNodeApplication;
  let db: Database;
  let cookie: string;

  beforeAll(async () => {
    ({ app: dashboardInstance, db } = await createTestApp());
    ({ app: inferenceInstance } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(dashboardInstance, {
      email: "ops@example.com",
      password: "ops password",
    });
  });

  afterAll(async () => {
    await inferenceInstance.close();
    await dashboardInstance.close();
  });

  it("refuses a key revoked on the dashboard of another instance", async () => {
    const { key, id } = await insertApiKey(dashboardInstance, db);
    await eventually(async () => {
      await request(inferenceInstance.getHttpServer())
        .get("/v1/models")
        .set("Authorization", `Bearer ${key}`)
        .expect(200);
    });

    await request(dashboardInstance.getHttpServer())
      .post(`/api/api-keys/${id}/revoke`)
      .set("Cookie", cookie)
      .expect(204);

    await eventually(async () => {
      await request(inferenceInstance.getHttpServer())
        .get("/v1/models")
        .set("Authorization", `Bearer ${key}`)
        .expect(401);
    });
  });

  it("stops listing a Model disabled on the dashboard of another instance", async () => {
    const { modelId } = await insertOpenAiChatModel(dashboardInstance, db, {
      modelName: "smart",
      baseUrl: "http://upstream.invalid/v1",
    });
    const { key } = await insertApiKey(dashboardInstance, db);

    await request(dashboardInstance.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set("Cookie", cookie)
      .send({ isEnabled: false })
      .expect(200);

    await eventually(async () => {
      const response = await request(inferenceInstance.getHttpServer())
        .get("/v1/models")
        .set("Authorization", `Bearer ${key}`)
        .expect(200);
      expect(response.body.data).toEqual([]);
    });
  });
});
