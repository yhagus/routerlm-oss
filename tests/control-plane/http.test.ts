import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { httpControlPlaneClient } from "@tests/support/control-plane-client.js";
import { createIntegration } from "@tests/support/integrations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app.js";
import { type ControlPlaneTransport, describeKeyScenarios } from "./key-scenarios.js";
import { describeLastUsedScenarios } from "./last-used-scenarios.js";
import { describeModelScenarios } from "./model-scenarios.js";
import { describeUsageScenarios } from "./usage-scenarios.js";

const HTTP_TRANSPORT: ControlPlaneTransport = {
  name: "HTTP",
  connect: async (app) => ({ client: httpControlPlaneClient(app), close: async () => {} }),
};

describeKeyScenarios(HTTP_TRANSPORT);
describeModelScenarios(HTTP_TRANSPORT);
describeUsageScenarios(HTTP_TRANSPORT);
describeLastUsedScenarios(HTTP_TRANSPORT);

describe("Control plane HTTP adapter (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table integrations, api_keys cascade`);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, { email: "ada@example.com", password: "ada's password" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers an error with its HTTP status and the gRPC code name", async () => {
    const { secret } = await createIntegration(app, adaCookie);

    const response = await request(app.getHttpServer())
      .post("/integration/v1/keys")
      .set("Authorization", `Bearer ${secret}`)
      .send({ name: "No Customer" })
      .expect(400);

    expect(response.body).toEqual({ code: "INVALID_ARGUMENT", message: expect.any(String) });
  });

  it("creates a key with 201 and refuses a dashboard session with 401", async () => {
    const { secret } = await createIntegration(app, adaCookie);

    await request(app.getHttpServer())
      .post("/integration/v1/keys")
      .set("Authorization", `Bearer ${secret}`)
      .send({ customerId: "cus_1" })
      .expect(201);
    const refused = await request(app.getHttpServer())
      .get("/integration/v1/keys")
      .set("Cookie", adaCookie)
      .expect(401);
    expect(refused.body).toEqual({ code: "UNAUTHENTICATED", message: expect.any(String) });
  });
});
