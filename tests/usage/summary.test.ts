import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations";
import { apiKeys, models, usageLogs, users } from "@/db/schemas";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app";

const ADA = { email: "ada@example.com", password: "ada's password" };

type NewUsageLog = typeof usageLogs.$inferInsert;

const SERVED_REQUEST: Omit<NewUsageLog, "createdAt"> = {
  clientProtocol: "openai-chat",
  isStreamed: false,
  httpStatus: 200,
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  requestBytes: 500,
  responseBytes: 800,
  cost: 0.25,
  durationMs: 900,
  attemptCount: 1,
};

describe("Usage API: summary totals (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;
  let smartId: string;
  let ciKeyId: string;
  let laptopKeyId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table usage_logs, api_keys, models cascade`);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
    [{ id: smartId }] = await db
      .insert(models)
      .values({ name: "smart" })
      .returning({ id: models.id });
    [{ id: ciKeyId }, { id: laptopKeyId }] = await db
      .insert(apiKeys)
      .values([
        { name: "CI", keyId: "ci", hash: "hash-ci" },
        { name: "Laptop", keyId: "laptop", hash: "hash-laptop" },
      ])
      .returning({ id: apiKeys.id });
  });

  afterAll(async () => {
    await app.close();
  });

  function getUsage(path: string) {
    return request(app.getHttpServer()).get(`/api/usage${path}`).set("Cookie", adaCookie);
  }

  it("summarizes statuses, tokens, Cost and latency percentiles over the filtered logs", async () => {
    const createdAt = new Date("2026-11-02T10:00:00Z");
    await db.insert(usageLogs).values([
      {
        ...SERVED_REQUEST,
        createdAt,
        durationMs: 100,
        timeToFirstTokenMs: 50,
        cacheReadTokens: 30,
        cacheWriteTokens: 5,
      },
      { ...SERVED_REQUEST, createdAt, durationMs: 200, timeToFirstTokenMs: 150, cost: null },
      {
        ...SERVED_REQUEST,
        createdAt,
        durationMs: 300,
        httpStatus: 502,
        errorCode: "upstream_error",
        inputTokens: null,
        outputTokens: null,
      },
      { ...SERVED_REQUEST, createdAt, durationMs: 400, isCancelled: true },
      { ...SERVED_REQUEST, createdAt, durationMs: 500 },
      { ...SERVED_REQUEST, createdAt: new Date("2026-10-01T10:00:00Z"), durationMs: 9000 },
    ]);

    const response = await getUsage("/totals?from=2026-11-01T00:00:00Z").expect(200);

    expect(response.body).toEqual({
      requestCount: 5,
      succeededCount: 3,
      failedCount: 1,
      failedByOrigin: { client: 0, upstream: 0, gateway: 0 },
      cancelledCount: 1,
      inputTokens: 400,
      outputTokens: 40,
      cacheReadTokens: 30,
      cacheWriteTokens: 5,
      cost: 1,
      durationMsP50: 300,
      durationMsP95: 480,
      timeToFirstTokenMsP50: 100,
      timeToFirstTokenMsP95: 145,
    });
  });

  it("summarizes no logs as zeros with no percentiles", async () => {
    const response = await getUsage("/totals").expect(200);

    expect(response.body).toEqual({
      requestCount: 0,
      succeededCount: 0,
      failedCount: 0,
      failedByOrigin: { client: 0, upstream: 0, gateway: 0 },
      cancelledCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      durationMsP50: null,
      durationMsP95: null,
      timeToFirstTokenMsP50: null,
      timeToFirstTokenMsP95: null,
    });
  });

  it("splits the failed count by Error Origin over the filtered logs", async () => {
    const createdAt = new Date("2026-11-02T10:00:00Z");
    const clientFailure = {
      httpStatus: 400,
      errorCode: "invalid_request",
      errorOrigin: "client",
    } satisfies Partial<NewUsageLog>;
    const upstreamFailure = {
      httpStatus: 502,
      errorCode: "upstream_error",
      errorOrigin: "upstream",
    } satisfies Partial<NewUsageLog>;
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt, modelId: smartId },
      { ...SERVED_REQUEST, createdAt, modelId: smartId, ...clientFailure },
      { ...SERVED_REQUEST, createdAt, modelId: smartId, ...clientFailure },
      { ...SERVED_REQUEST, createdAt, modelId: smartId, ...upstreamFailure },
      { ...SERVED_REQUEST, createdAt, modelId: smartId, httpStatus: 502 },
      { ...SERVED_REQUEST, createdAt, ...upstreamFailure },
    ]);

    const response = await getUsage(`/totals?modelId=${smartId}`).expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        failedCount: 4,
        failedByOrigin: { client: 2, upstream: 1, gateway: 0 },
      }),
    );
  });

  it("matches the listed API Keys or the Playground when both are asked for", async () => {
    const [{ id: adaId }] = await db.select({ id: users.id }).from(users);
    const [{ id: scriptKeyId }] = await db
      .insert(apiKeys)
      .values({ name: "Script", keyId: "script", hash: "hash-script" })
      .returning({ id: apiKeys.id });
    const createdAt = new Date("2026-11-02T10:00:00Z");
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt, modelId: smartId, apiKeyId: ciKeyId },
      { ...SERVED_REQUEST, createdAt, modelId: smartId, apiKeyId: laptopKeyId },
      { ...SERVED_REQUEST, createdAt, modelId: smartId, apiKeyId: scriptKeyId },
      { ...SERVED_REQUEST, createdAt, modelId: smartId, userId: adaId, isPlayground: true },
    ]);

    const response = await getUsage(
      `/totals?apiKeyId=${ciKeyId},${laptopKeyId}&isPlayground=true`,
    ).expect(200);

    expect(response.body.requestCount).toBe(3);
  });
});
