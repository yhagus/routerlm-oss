import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { apiKeys, usageLogs } from "@/db/schemas";
import type { Database } from "@/db/schemas/relations";
import {
  type ControlPlaneClient,
  httpControlPlaneClient,
} from "@tests/support/control-plane-client";
import { insertOpenAiChatModel } from "@tests/support/inference";
import { createIntegration } from "@tests/support/integrations";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app";

const ADA = { email: "ada@example.com", password: "ada's password" };
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const UNUSED_BASE_URL = "http://127.0.0.1:1/v1";

const REQUEST_OF_A_CUSTOMER: Omit<typeof usageLogs.$inferInsert, "createdAt"> = {
  modelName: "smart",
  clientProtocol: "openai-chat",
  isStreamed: false,
  httpStatus: 200,
  requestBytes: 500,
  responseBytes: 120,
  durationMs: 800,
  attemptCount: 1,
};

describe("An Integration's detail page (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let client: ControlPlaneClient;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    client = httpControlPlaneClient(app);
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table integrations, api_keys, usage_logs, models, providers cascade`,
    );
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  async function issueKey(secret: string, customerId: string): Promise<string> {
    const created = await client.createKey(secret, { customerId });
    if (!created.ok) throw new Error(`createKey failed with ${created.code}`);
    return created.body.apiKey.id;
  }

  async function revokeKey(secret: string, id: string): Promise<void> {
    const revoked = await client.revokeKey(secret, id);
    if (!revoked.ok) throw new Error(`revokeKey failed with ${revoked.code}`);
  }

  function getAsAda(path: string): request.Test {
    return request(app.getHttpServer()).get(path).set("Cookie", adaCookie);
  }

  it("shows an Integration with how many active and revoked keys and Customers it has", async () => {
    const acme = await createIntegration(app, adaCookie);
    const firstKeyId = await issueKey(acme.secret, "cus_alpha");
    await issueKey(acme.secret, "cus_alpha");
    await issueKey(acme.secret, "cus_beta");
    await revokeKey(acme.secret, firstKeyId);

    const detail = await getAsAda(`/api/integrations/${acme.id}`).expect(200);

    expect(detail.body).toMatchObject({
      id: acme.id,
      name: "Acme SaaS",
      createdBy: { email: ADA.email },
      lastRotatedAt: null,
      activeKeyCount: 2,
      revokedKeyCount: 1,
      customerCount: 2,
    });
  });

  it("shows that an Integration's secret was never used before its first call", async () => {
    const acme = await createIntegration(app, adaCookie);

    const detail = await getAsAda(`/api/integrations/${acme.id}`).expect(200);
    const list = await getAsAda("/api/integrations").expect(200);

    expect(detail.body).toMatchObject({ lastUsedAt: null, activeKeyCount: 0, customerCount: 0 });
    expect(list.body).toEqual([expect.objectContaining({ lastUsedAt: null })]);
  });

  it("lists the secret's rotations newest first, with who rotated it", async () => {
    const acme = await createIntegration(app, adaCookie);
    const first = await request(app.getHttpServer())
      .post(`/api/integrations/${acme.id}/rotate`)
      .set("Cookie", adaCookie)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/integrations/${acme.id}/rotate`)
      .set("Cookie", adaCookie)
      .expect(201);
    const keyIdOf = (secret: string): string => secret.split("_")[1];

    const rotations = await getAsAda(`/api/integrations/${acme.id}/rotations`).expect(200);

    expect(rotations.body).toEqual([
      {
        id: expect.any(String),
        rotatedAt: expect.any(String),
        rotatedBy: { id: expect.any(String), email: ADA.email },
        previousKeyId: keyIdOf(first.body.secret),
        newKeyId: keyIdOf(second.body.secret),
      },
      {
        id: expect.any(String),
        rotatedAt: expect.any(String),
        rotatedBy: { id: expect.any(String), email: ADA.email },
        previousKeyId: keyIdOf(acme.secret),
        newKeyId: keyIdOf(first.body.secret),
      },
    ]);
  });

  describe("its Customers", () => {
    let acmeId: string;

    beforeEach(async () => {
      const acme = await createIntegration(app, adaCookie);
      acmeId = acme.id;
      const revokedAlphaKeyId = await issueKey(acme.secret, "cus_alpha");
      await issueKey(acme.secret, "cus_alpha");
      await issueKey(acme.secret, "cus_beta");
      await issueKey(acme.secret, "other_gamma");
      await revokeKey(acme.secret, revokedAlphaKeyId);
      await db.update(apiKeys).set({ spent: 0.4 }).where(eq(apiKeys.customerId, "cus_alpha"));
      await db.update(apiKeys).set({ spent: 1 }).where(eq(apiKeys.customerId, "cus_beta"));
      const ofAcme = { integrationId: acme.id, integrationName: "Acme SaaS" };
      await db.insert(usageLogs).values([
        {
          ...REQUEST_OF_A_CUSTOMER,
          ...ofAcme,
          customerId: "cus_alpha",
          createdAt: new Date("2026-11-01T10:00:00Z"),
          cost: 0.5,
        },
        {
          ...REQUEST_OF_A_CUSTOMER,
          ...ofAcme,
          customerId: "cus_alpha",
          createdAt: new Date("2026-11-01T11:00:00Z"),
          cost: 0.25,
        },
        {
          ...REQUEST_OF_A_CUSTOMER,
          ...ofAcme,
          customerId: "cus_beta",
          createdAt: new Date("2026-11-01T12:00:00Z"),
          cost: null,
        },
      ]);
    });

    it("rolls each Customer up, most recently active first and never-active last, a page at a time", async () => {
      const firstPage = await getAsAda(`/api/integrations/${acmeId}/customers`)
        .query({ pageSize: 2 })
        .expect(200);
      const secondPage = await getAsAda(`/api/integrations/${acmeId}/customers`)
        .query({ pageSize: 2, page: 2 })
        .expect(200);

      expect(firstPage.body).toEqual({
        items: [
          {
            customerId: "cus_beta",
            activeKeyCount: 1,
            revokedKeyCount: 0,
            spent: 1,
            requestCount: 1,
            cost: 0,
            lastRequestAt: "2026-11-01T12:00:00.000Z",
          },
          {
            customerId: "cus_alpha",
            activeKeyCount: 1,
            revokedKeyCount: 1,
            spent: 0.8,
            requestCount: 2,
            cost: 0.75,
            lastRequestAt: "2026-11-01T11:00:00.000Z",
          },
        ],
        total: 3,
        page: 1,
        pageSize: 2,
      });
      expect(secondPage.body).toEqual({
        items: [
          {
            customerId: "other_gamma",
            activeKeyCount: 1,
            revokedKeyCount: 0,
            spent: 0,
            requestCount: 0,
            cost: 0,
            lastRequestAt: null,
          },
        ],
        total: 3,
        page: 2,
        pageSize: 2,
      });
    });

    it("finds Customers by the start of their id", async () => {
      const found = await getAsAda(`/api/integrations/${acmeId}/customers`)
        .query({ search: "cus_" })
        .expect(200);

      expect(found.body).toMatchObject({
        items: [{ customerId: "cus_beta" }, { customerId: "cus_alpha" }],
        total: 2,
      });
    });

    it("rejects a page larger than the largest page", async () => {
      await getAsAda(`/api/integrations/${acmeId}/customers`).query({ pageSize: 101 }).expect(400);
    });
  });

  it("lists the Models an Integration may sell exactly as its control plane does", async () => {
    const smart = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: UNUSED_BASE_URL,
    });
    await insertOpenAiChatModel(app, db, { modelName: "other", baseUrl: UNUSED_BASE_URL });
    const acme = await createIntegration(app, adaCookie, {
      name: "Acme SaaS",
      allowedModelIds: [smart.modelId],
    });

    const listed = await getAsAda(`/api/integrations/${acme.id}/models`).expect(200);
    const toldTheIntegration = await client.listModels(acme.secret);

    expect(listed.body).toMatchObject({ models: [{ id: smart.modelId, name: "smart" }] });
    expect(toldTheIntegration).toEqual({ ok: true, body: listed.body });
  });

  it.each(["", "/rotations", "/customers", "/models"])(
    "answers 404 at /integrations/:id%s for an Integration that does not exist",
    async (subPath) => {
      await getAsAda(`/api/integrations/${UNKNOWN_ID}${subPath}`).expect(404);
    },
  );
});
