import type { NestNodeApplication } from "@nestjs/platform-node";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import request from "supertest";
import { relations } from "@/db/schemas/relations.js";
import { createTestApp } from "@tests/support/test-app.js";

// Port 1 refuses every connection, so this Postgres never answers.
const UNREACHABLE_DATABASE_URL = "postgres://routerlm:routerlm@127.0.0.1:1/routerlm";

describe("GET /health (e2e)", () => {
  describe("when Postgres answers", () => {
    let app: NestNodeApplication;

    beforeAll(async () => {
      ({ app } = await createTestApp());
    });

    afterAll(async () => {
      await app?.close();
    });

    it("reports healthy to a caller without a session", async () => {
      const response = await request(app.getHttpServer()).get("/health").expect(200);

      expect(response.body).toMatchObject({ status: "ok", info: { database: { status: "up" } } });
    });
  });

  describe("when Postgres does not answer", () => {
    let app: NestNodeApplication;
    let unreachablePool: Pool;

    beforeAll(async () => {
      unreachablePool = new Pool({ connectionString: UNREACHABLE_DATABASE_URL });
      // No Setting can be saved to a database that never answers.
      ({ app } = await createTestApp(drizzle({ client: unreachablePool, relations }), {
        allowsPrivateUpstreams: false,
      }));
    });

    afterAll(async () => {
      await app?.close();
      await unreachablePool?.end();
    });

    it("reports the database down with 503 and no internal error text", async () => {
      const response = await request(app.getHttpServer()).get("/health").expect(503);

      expect(response.body).toMatchObject({
        status: "error",
        error: { database: { status: "down" } },
      });
      expect(JSON.stringify(response.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|connect/i);
    });
  });
});
