import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import {
  apiKeys,
  attempts,
  errorCaptures,
  models,
  providerAccounts,
  providers,
  usageLogs,
} from "@/db/schemas/index.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const CAPTURED_AT = new Date("2026-11-10T10:00:00Z");

type NewUsageLog = typeof usageLogs.$inferInsert;
type NewAttempt = typeof attempts.$inferInsert;
type NewErrorCapture = typeof errorCaptures.$inferInsert;

const FAILED_REQUEST: Omit<NewUsageLog, "createdAt"> = {
  modelName: "smart",
  clientProtocol: "openai-chat",
  isStreamed: false,
  httpStatus: 502,
  errorCode: "upstream_error",
  errorOrigin: "upstream",
  requestBytes: 20,
  responseBytes: 80,
  durationMs: 300,
  attemptCount: 1,
};

const FAILED_ATTEMPT: Omit<NewAttempt, "usageLogId"> = {
  startedAt: CAPTURED_AT,
  providerSlug: "acme",
  providerName: "Acme",
  upstreamStatus: 500,
  failureReason: "server_error",
  durationMs: 250,
};

/** What one capture is made of; an `attempt` makes it a gateway-to-provider-account capture. */
interface CaptureSetup {
  usageLog?: Partial<NewUsageLog>;
  attempt?: Partial<NewAttempt>;
  capture?: Partial<NewErrorCapture>;
}

describe("Error Captures API: filtering the list (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;
  let smartId: string;
  let fastId: string;
  let ciKeyId: string;
  let laptopKeyId: string;
  let mainAccountId: string;
  let spareAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table usage_logs, api_keys, models, providers cascade`);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
    [{ id: smartId }, { id: fastId }] = await db
      .insert(models)
      .values([{ name: "smart" }, { name: "fast" }])
      .returning({ id: models.id });
    [{ id: ciKeyId }, { id: laptopKeyId }] = await db
      .insert(apiKeys)
      .values([
        { name: "CI", keyId: "ci", hash: "hash-ci" },
        { name: "Laptop", keyId: "laptop", hash: "hash-laptop" },
      ])
      .returning({ id: apiKeys.id });
    const [{ id: providerId }] = await db
      .insert(providers)
      .values({
        slug: "acme",
        name: "Acme",
        endpoints: [{ kind: "chat", protocol: "openai-chat", baseUrl: "https://acme.test/v1" }],
        authStyle: "bearer",
      })
      .returning({ id: providers.id });
    [{ id: mainAccountId }, { id: spareAccountId }] = await db
      .insert(providerAccounts)
      .values([
        { providerId, name: "Acme main", encryptedKey: "v1.x.y.z", keyLastFour: "1234" },
        { providerId, name: "Acme spare", encryptedKey: "v1.x.y.z", keyLastFour: "5678" },
      ])
      .returning({ id: providerAccounts.id });
  });

  afterAll(async () => {
    await app.close();
  });

  /** Records a failed request with one capture, and returns the capture's id. */
  async function capture({ usageLog, attempt, capture }: CaptureSetup = {}): Promise<string> {
    const [{ id: usageLogId }] = await db
      .insert(usageLogs)
      .values({ ...FAILED_REQUEST, createdAt: CAPTURED_AT, modelId: smartId, ...usageLog })
      .returning({ id: usageLogs.id });
    const attemptId =
      attempt === undefined
        ? undefined
        : (
            await db
              .insert(attempts)
              .values({ ...FAILED_ATTEMPT, usageLogId, ...attempt })
              .returning({ id: attempts.id })
          )[0].id;
    const [{ id }] = await db
      .insert(errorCaptures)
      .values({
        usageLogId,
        attemptId,
        createdAt: CAPTURED_AT,
        requestHeaders: {},
        requestBody: "{}",
        ...capture,
      })
      .returning({ id: errorCaptures.id });
    return id;
  }

  /** The ids of the captures the list returns for `query`, after checking the total agrees. */
  async function listedIds(query: string): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .get(`/api/error-captures?${query}`)
      .set("Cookie", adaCookie)
      .expect(200);
    expect(response.body.total).toBe(response.body.items.length);
    return response.body.items.map((item: { id: string }) => item.id).sort();
  }

  it("filters by capture time, from inclusive and to exclusive", async () => {
    const atFrom = await capture({ capture: { createdAt: new Date("2026-11-02T00:00:00Z") } });
    await capture({ capture: { createdAt: new Date("2026-11-03T00:00:00Z") } });

    const ids = await listedIds("from=2026-11-02T00:00:00Z&to=2026-11-03T00:00:00%2B00:00");

    expect(ids).toEqual([atFrom]);
  });

  it("filters by any of several Models", async () => {
    const smart = await capture();
    const fast = await capture({ usageLog: { modelId: fastId, modelName: "fast" } });
    await capture({ usageLog: { modelId: null } });

    expect(await listedIds(`modelId=${smartId},${fastId}`)).toEqual([smart, fast].sort());
  });

  it("filters by API Key, widened to the Playground when both are picked", async () => {
    const ci = await capture({ usageLog: { apiKeyId: ciKeyId, apiKeyName: "CI" } });
    await capture({ usageLog: { apiKeyId: laptopKeyId, apiKeyName: "Laptop" } });
    const playground = await capture({ usageLog: { isPlayground: true } });

    expect(await listedIds(`apiKeyId=${ciKeyId}`)).toEqual([ci]);
    expect(await listedIds(`apiKeyId=${ciKeyId}&isPlayground=true`)).toEqual(
      [ci, playground].sort(),
    );
  });

  it("filters by Integration and by Customer id", async () => {
    const acmeId = "11111111-1111-4111-8111-111111111111";
    const acmeCustomer = await capture({
      usageLog: { integrationId: acmeId, customerId: "cus_1" },
    });
    await capture({ usageLog: { integrationId: acmeId, customerId: "cus_2" } });
    await capture({ usageLog: { apiKeyId: ciKeyId, apiKeyName: "CI" } });

    expect(await listedIds(`integrationId=${acmeId}&customerId=cus_1`)).toEqual([acmeCustomer]);
  });

  it("filters by Error Origin", async () => {
    const client = await capture({ usageLog: { errorOrigin: "client", httpStatus: 400 } });
    const gateway = await capture({ usageLog: { errorOrigin: "gateway", httpStatus: 500 } });
    await capture();

    expect(await listedIds("errorOrigin=client,gateway")).toEqual([client, gateway].sort());
  });

  it("filters by the hop that failed", async () => {
    const clientToGateway = await capture();
    const toProviderAccount = await capture({ attempt: { providerAccountId: mainAccountId } });

    expect(await listedIds("failedAt=client-to-gateway")).toEqual([clientToGateway]);
    expect(await listedIds("failedAt=gateway-to-provider-account")).toEqual([toProviderAccount]);
  });

  it("filters by the Attempt's Provider Account", async () => {
    const main = await capture({ attempt: { providerAccountId: mainAccountId } });
    await capture({ attempt: { providerAccountId: spareAccountId } });
    await capture();

    expect(await listedIds(`providerAccountId=${mainAccountId}`)).toEqual([main]);
  });

  it("filters by the Attempt's failure reason", async () => {
    const timedOut = await capture({ attempt: { failureReason: "timeout" } });
    const cancelled = await capture({ attempt: { failureReason: "cancelled" } });
    await capture({ attempt: { failureReason: "server_error" } });

    expect(await listedIds("failureReason=timeout,cancelled")).toEqual(
      [timedOut, cancelled].sort(),
    );
  });

  it("filters by whether the client's request recovered or failed", async () => {
    const recovered = await capture({
      usageLog: { httpStatus: 200, errorCode: null, errorOrigin: null },
      attempt: {},
    });
    const failed = await capture();

    expect(await listedIds("outcome=recovered")).toEqual([recovered]);
    expect(await listedIds("outcome=failed")).toEqual([failed]);
  });

  it("searches the capture's User-Agent and client IP and the upstream request id", async () => {
    const python = await capture({ capture: { userAgent: "OpenAI/Python 1.54.0" } });
    const fromIp = await capture({ capture: { clientIp: "203.0.113.7" } });
    const upstream = await capture({ attempt: { upstreamRequestId: "req_ACME_42" } });

    expect(await listedIds("q=python")).toEqual([python]);
    expect(await listedIds("q=113.7")).toEqual([fromIp]);
    expect(await listedIds("q=acme_4")).toEqual([upstream]);
  });

  it("rejects an unknown enum value with 400", async () => {
    await request(app.getHttpServer())
      .get("/api/error-captures?failedAt=somewhere")
      .set("Cookie", adaCookie)
      .expect(400);
  });
});
