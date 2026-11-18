import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import { vi } from "vitest";
import type { Database } from "@/db/schemas/relations.js";
import { RedisConnection } from "@/redis/providers/redis-connection.js";
import { insertApiKey, insertOpenAiChatModel } from "../support/inference.js";
import { createTestApp, setUpFirstUser } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

// Lets a test make the next snapshot reloads fail, as a database hiccup would.
const reloads = vi.hoisted(() => ({ failuresLeft: 0 }));

vi.mock("@/snapshot/models/load-snapshot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/snapshot/models/load-snapshot.js")>();
  return {
    ...actual,
    loadSnapshot: async (...args: Parameters<typeof actual.loadSnapshot>) => {
      if (reloads.failuresLeft > 0) {
        reloads.failuresLeft -= 1;
        throw new Error("forced snapshot reload failure");
      }
      return actual.loadSnapshot(...args);
    },
  };
});

// Spec "Inference path": a dashboard change takes effect within about a second.
const PROPAGATION_LIMIT_MS = 1000;
const POLL_INTERVAL_MS = 50;
// Far shorter than the production default, so the interval reload fits the limit above.
const SNAPSHOT_RELOAD_INTERVAL_MS = "200";
process.env.SNAPSHOT_RELOAD_INTERVAL_MS = SNAPSHOT_RELOAD_INTERVAL_MS;

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

  it("refuses a revoked key on another instance even when the publish was lost", async () => {
    const { key, id } = await insertApiKey(dashboardInstance, db);
    await eventually(async () => {
      await request(inferenceInstance.getHttpServer())
        .get("/v1/models")
        .set("Authorization", `Bearer ${key}`)
        .expect(200);
    });
    const publish = vi
      .spyOn(dashboardInstance.get(RedisConnection).client, "publish")
      .mockRejectedValue(new Error("Redis is down"));

    try {
      await request(dashboardInstance.getHttpServer())
        .post(`/api/api-keys/${id}/revoke`)
        .set("Cookie", cookie)
        .expect(204);
    } finally {
      publish.mockRestore();
    }

    await eventually(async () => {
      await request(inferenceInstance.getHttpServer())
        .get("/v1/models")
        .set("Authorization", `Bearer ${key}`)
        .expect(401);
    });
  });

  it("retries a failed reload until the revoking instance refuses the key too", async () => {
    // A long interval, so only the retry after the failed reload can fix this instance.
    process.env.SNAPSHOT_RELOAD_INTERVAL_MS = "3600000";
    const { app: revokingInstance } = await createTestApp();
    process.env.SNAPSHOT_RELOAD_INTERVAL_MS = SNAPSHOT_RELOAD_INTERVAL_MS;
    try {
      const { key, id } = await insertApiKey(revokingInstance, db);
      await request(revokingInstance.getHttpServer())
        .get("/v1/models")
        .set("Authorization", `Bearer ${key}`)
        .expect(200);

      reloads.failuresLeft = 1;
      await request(revokingInstance.getHttpServer())
        .post(`/api/api-keys/${id}/revoke`)
        .set("Cookie", cookie)
        .expect(204);

      await eventually(async () => {
        await request(revokingInstance.getHttpServer())
          .get("/v1/models")
          .set("Authorization", `Bearer ${key}`)
          .expect(401);
      });
    } finally {
      reloads.failuresLeft = 0;
      await revokingInstance.close();
    }
  });
});
