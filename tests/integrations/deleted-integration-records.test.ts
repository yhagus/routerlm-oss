import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { errorCaptures, usageLogs } from "@/db/schemas/index.js";
import { createIntegration } from "@tests/support/integrations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app.js";

const ADA = { email: "ada@example.com", password: "ada's password" };

describe("A deleted Integration's records (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table integrations, usage_logs cascade`);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  /** A failed request of a Customer key, recorded with an Error Capture, then the Integration deleted. */
  async function recordFailedCustomerRequestThenDeleteIntegration(): Promise<{
    integrationId: string;
    usageLogId: string;
    captureId: string;
  }> {
    const integration = await createIntegration(app, adaCookie, { name: "Acme SaaS" });
    const [{ id: usageLogId }] = await db
      .insert(usageLogs)
      .values({
        createdAt: new Date(),
        apiKeyName: "customer key",
        integrationId: integration.id,
        integrationName: "Acme SaaS",
        customerId: "customer-42",
        clientProtocol: "openai-chat",
        isStreamed: false,
        httpStatus: 502,
        errorCode: "upstream_error",
        errorOrigin: "upstream",
        requestBytes: 20,
        responseBytes: 80,
        durationMs: 300,
        attemptCount: 0,
      })
      .returning({ id: usageLogs.id });
    const [{ id: captureId }] = await db
      .insert(errorCaptures)
      .values({ usageLogId, createdAt: new Date(), requestHeaders: {}, requestBody: "{}" })
      .returning({ id: errorCaptures.id });
    await request(app.getHttpServer())
      .delete(`/api/integrations/${integration.id}`)
      .set("Cookie", adaCookie)
      .expect(204);
    return { integrationId: integration.id, usageLogId, captureId };
  }

  function get(path: string): request.Test {
    return request(app.getHttpServer()).get(path).set("Cookie", adaCookie).expect(200);
  }

  it("still shows its name and Customer id in the Usage Logs", async () => {
    const { integrationId, usageLogId } = await recordFailedCustomerRequestThenDeleteIntegration();
    const expected = { integrationId, integrationName: "Acme SaaS", customerId: "customer-42" };

    const list = await get("/api/usage");
    const detail = await get(`/api/usage/${usageLogId}`);

    expect(list.body.items).toEqual([expect.objectContaining(expected)]);
    expect(detail.body).toMatchObject(expected);
  });

  it("still shows its name and Customer id in the Error Captures", async () => {
    const { integrationId, captureId } = await recordFailedCustomerRequestThenDeleteIntegration();
    const expected = { integrationId, integrationName: "Acme SaaS", customerId: "customer-42" };

    const list = await get("/api/error-captures");
    const detail = await get(`/api/error-captures/${captureId}`);

    expect(list.body.items).toEqual([expect.objectContaining(expected)]);
    expect(detail.body).toMatchObject(expected);
  });
});
