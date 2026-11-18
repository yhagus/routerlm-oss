import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys, models, usageLogs, users } from "@/db/schemas/index.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "../support/test-app.js";

const ADA = { email: "ada@example.com", password: "ada's password" };

type NewUsageLog = typeof usageLogs.$inferInsert;
/** A Model's or API Key's id with the name a Usage Log copies of it (ADR 0024). */
type ModelColumns = Pick<NewUsageLog, "modelId" | "modelName">;
type ApiKeyColumns = Pick<NewUsageLog, "apiKeyId" | "apiKeyName">;

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

describe("Usage API: listing and filtering Usage Logs (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;
  let smartId: string;
  let fastId: string;
  let ciKeyId: string;
  let laptopKeyId: string;
  let smart: ModelColumns;
  let fast: ModelColumns;
  let ci: ApiKeyColumns;
  let laptop: ApiKeyColumns;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table usage_logs, api_keys, models cascade`);
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
    smart = { modelId: smartId, modelName: "smart" };
    fast = { modelId: fastId, modelName: "fast" };
    ci = { apiKeyId: ciKeyId, apiKeyName: "CI" };
    laptop = { apiKeyId: laptopKeyId, apiKeyName: "Laptop" };
  });

  afterAll(async () => {
    await app.close();
  });

  function getUsage(path: string) {
    return request(app.getHttpServer()).get(`/api/usage${path}`).set("Cookie", adaCookie);
  }

  it("lists Usage Logs newest first, one page at a time, with Model and API Key names", async () => {
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt: new Date("2026-11-01T10:00:00Z"), ...smart },
      {
        ...SERVED_REQUEST,
        createdAt: new Date("2026-11-01T11:00:00Z"),
        ...fast,
        ...ci,
      },
      { ...SERVED_REQUEST, createdAt: new Date("2026-11-01T12:00:00Z"), ...smart },
    ]);

    const firstPage = await getUsage("?pageSize=2").expect(200);
    const secondPage = await getUsage("?pageSize=2&page=2").expect(200);

    expect(firstPage.body.total).toBe(3);
    expect(firstPage.body.items.map((item: { createdAt: string }) => item.createdAt)).toEqual([
      "2026-11-01T12:00:00.000Z",
      "2026-11-01T11:00:00.000Z",
    ]);
    expect(firstPage.body.items[1]).toMatchObject({
      modelName: "fast",
      apiKeyName: "CI",
      cost: 0.25,
      inputTokens: 100,
    });
    expect(secondPage.body.items).toHaveLength(1);
  });

  it("filters by time range, Model, API Key and status", async () => {
    const inRange = new Date("2026-11-02T10:00:00Z");
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt: inRange, ...smart, ...ci },
      {
        ...SERVED_REQUEST,
        createdAt: inRange,
        ...smart,
        ...ci,
        httpStatus: 502,
        errorCode: "upstream_error",
      },
      {
        ...SERVED_REQUEST,
        createdAt: inRange,
        ...smart,
        ...ci,
        isCancelled: true,
      },
      { ...SERVED_REQUEST, createdAt: inRange, ...fast, ...ci },
      { ...SERVED_REQUEST, createdAt: inRange, ...smart, ...laptop },
      {
        ...SERVED_REQUEST,
        createdAt: new Date("2026-11-05T10:00:00Z"),
        ...smart,
        ...ci,
      },
    ]);
    const filters =
      `from=2026-11-02T00:00:00Z&to=2026-11-03T00:00:00Z` +
      `&modelId=${smartId}&apiKeyId=${ciKeyId}`;

    const succeeded = await getUsage(`?${filters}&status=succeeded`).expect(200);
    const failed = await getUsage(`?${filters}&status=failed`).expect(200);
    const cancelled = await getUsage(`?${filters}&status=cancelled`).expect(200);

    expect(succeeded.body.total).toBe(1);
    expect(failed.body.items).toEqual([
      expect.objectContaining({ httpStatus: 502, errorCode: "upstream_error" }),
    ]);
    expect(cancelled.body.items).toEqual([expect.objectContaining({ isCancelled: true })]);
  });

  it("filters on Playground requests", async () => {
    const [{ id: adaId }] = await db.select({ id: users.id }).from(users);
    const createdAt = new Date("2026-11-02T10:00:00Z");
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt, ...smart, ...ci },
      { ...SERVED_REQUEST, createdAt, ...smart, userId: adaId, isPlayground: true },
    ]);

    const response = await getUsage("?isPlayground=true").expect(200);

    expect(response.body.items).toEqual([
      expect.objectContaining({ isPlayground: true, apiKeyId: null }),
    ]);
  });

  it("filters on the served Service Tier, in the list and its totals", async () => {
    const createdAt = new Date("2026-11-02T10:00:00Z");
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt, ...smart, serviceTier: "fast" },
      { ...SERVED_REQUEST, createdAt, ...smart, serviceTier: "flex" },
      { ...SERVED_REQUEST, createdAt, ...smart },
    ]);

    const response = await getUsage("?serviceTier=fast").expect(200);
    const summary = await getUsage("/totals?serviceTier=fast,flex").expect(200);

    expect(response.body.items).toEqual([expect.objectContaining({ serviceTier: "fast" })]);
    expect(summary.body).toEqual(expect.objectContaining({ requestCount: 2 }));
  });

  it("matches any of several Models and any of several statuses", async () => {
    const [{ id: cheapId }] = await db
      .insert(models)
      .values({ name: "cheap" })
      .returning({ id: models.id });
    const createdAt = new Date("2026-11-02T10:00:00Z");
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt, ...smart, httpStatus: 502 },
      { ...SERVED_REQUEST, createdAt, ...fast, isCancelled: true },
      { ...SERVED_REQUEST, createdAt, ...fast },
      { ...SERVED_REQUEST, createdAt, modelId: cheapId, modelName: "cheap", httpStatus: 502 },
    ]);

    const response = await getUsage(`?modelId=${smartId},${fastId}&status=failed,cancelled`).expect(
      200,
    );

    const summary = await getUsage(
      `/totals?modelId=${smartId},${fastId}&status=failed,cancelled`,
    ).expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelId: smartId, httpStatus: 502 }),
        expect.objectContaining({ modelId: fastId, isCancelled: true }),
      ]),
    );
    expect(summary.body).toEqual(
      expect.objectContaining({ requestCount: 2, failedCount: 1, cancelledCount: 1 }),
    );
  });

  it("searches Model names, API Key names and error codes, ignoring case", async () => {
    const createdAt = new Date("2026-11-02T10:00:00Z");
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt, ...smart, ...ci },
      { ...SERVED_REQUEST, createdAt, ...fast, ...laptop },
      {
        ...SERVED_REQUEST,
        createdAt,
        ...fast,
        ...ci,
        httpStatus: 504,
        errorCode: "upstream_timeout",
      },
    ]);

    const byModel = await getUsage("?q=SMA").expect(200);
    const byApiKey = await getUsage("?q=lapTOP").expect(200);
    const byErrorCode = await getUsage("?q=TIMEOUT").expect(200);

    expect(byModel.body.items).toEqual([expect.objectContaining({ modelName: "smart" })]);
    expect(byApiKey.body.items).toEqual([expect.objectContaining({ apiKeyName: "Laptop" })]);
    expect(byErrorCode.body.items).toEqual([
      expect.objectContaining({ errorCode: "upstream_timeout" }),
    ]);
  });

  it("finds a Usage Log by its exact id", async () => {
    const createdAt = new Date("2026-11-02T10:00:00Z");
    const [{ id }] = await db
      .insert(usageLogs)
      .values([
        { ...SERVED_REQUEST, createdAt, ...smart },
        { ...SERVED_REQUEST, createdAt, ...fast },
      ])
      .returning({ id: usageLogs.id });

    const response = await getUsage(`?q=${id}`).expect(200);

    expect(response.body.items).toEqual([expect.objectContaining({ id })]);
  });

  it("matches %, _ and \\ in the search literally", async () => {
    const [{ id: underscoredId }, { id: percentId }, { id: backslashId }] = await db
      .insert(models)
      .values([{ name: "gpt_4" }, { name: "50%off" }, { name: "a\\b" }])
      .returning({ id: models.id });
    const createdAt = new Date("2026-11-02T10:00:00Z");
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt, modelId: underscoredId, modelName: "gpt_4" },
      { ...SERVED_REQUEST, createdAt, modelId: percentId, modelName: "50%off" },
      { ...SERVED_REQUEST, createdAt, modelId: backslashId, modelName: "a\\b" },
      { ...SERVED_REQUEST, createdAt, ...smart },
    ]);

    const underscore = await getUsage("?q=_").expect(200);
    const percent = await getUsage(`?q=${encodeURIComponent("%")}`).expect(200);
    const backslash = await getUsage(`?q=${encodeURIComponent("\\")}`).expect(200);

    expect(underscore.body.items).toEqual([expect.objectContaining({ modelName: "gpt_4" })]);
    expect(percent.body.items).toEqual([expect.objectContaining({ modelName: "50%off" })]);
    expect(backslash.body.items).toEqual([expect.objectContaining({ modelName: "a\\b" })]);
  });

  it("combines the search with the other filters, in the list and its totals", async () => {
    const createdAt = new Date("2026-11-02T10:00:00Z");
    await db.insert(usageLogs).values([
      { ...SERVED_REQUEST, createdAt, ...smart, ...ci },
      { ...SERVED_REQUEST, createdAt, ...smart, ...ci, httpStatus: 502 },
      { ...SERVED_REQUEST, createdAt, ...fast, ...ci, httpStatus: 502 },
    ]);

    const response = await getUsage("?q=smart&status=failed").expect(200);
    const summary = await getUsage("/totals?q=smart&status=failed").expect(200);

    expect(response.body.items).toEqual([
      expect.objectContaining({ modelName: "smart", httpStatus: 502 }),
    ]);
    expect(summary.body).toEqual(expect.objectContaining({ requestCount: 1, failedCount: 1 }));
  });

  it("refuses a list with an element that is not a valid value", async () => {
    await getUsage(`?modelId=${smartId},not-a-uuid`).expect(400);
    await getUsage("/totals?status=failed,,cancelled").expect(400);
    await getUsage("?serviceTier=fast,priority").expect(400);
  });

  it("refuses a page size over the limit", async () => {
    await getUsage("?pageSize=10000").expect(400);
  });

  it("is only for signed-in Users", async () => {
    await request(app.getHttpServer()).get("/api/usage").expect(401);
  });
});
