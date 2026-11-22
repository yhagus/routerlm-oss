import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import { errorCaptures, usageLogs } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION = { days: 7, defaultDays: 7, isDefault: true, min: 1, max: 365 };

describe("Error Capture Retention Period setting (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table settings, usage_logs cascade`);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  function retentionRequest(method: "get" | "put" | "delete", path = "") {
    return request(app.getHttpServer())
      [method](`/api/settings/error-capture-retention${path}`)
      .set("Cookie", adaCookie);
  }

  it("shows the default until a User changes it", async () => {
    const response = await retentionRequest("get").expect(200);

    expect(response.body).toEqual(DEFAULT_RETENTION);
  });

  it("saves a new Retention Period and shows it afterwards", async () => {
    const saved = await retentionRequest("put").send({ days: 30 }).expect(200);
    const shown = await retentionRequest("get").expect(200);

    const expected = { ...DEFAULT_RETENTION, days: 30, isDefault: false };
    expect(saved.body).toEqual(expected);
    expect(shown.body).toEqual(expected);
  });

  it("rejects a Retention Period outside 1 to 365 days or not a whole number", async () => {
    await retentionRequest("put").send({ days: 0 }).expect(400);
    await retentionRequest("put").send({ days: 366 }).expect(400);
    await retentionRequest("put").send({ days: 1.5 }).expect(400);
    await retentionRequest("put").send({}).expect(400);
    await retentionRequest("get", "/impact?days=0").expect(400);
    await retentionRequest("get", "/impact").expect(400);

    expect((await retentionRequest("get")).body).toEqual(DEFAULT_RETENTION);
  });

  it("returns to the default when reset", async () => {
    await retentionRequest("put").send({ days: 30 }).expect(200);

    const reset = await retentionRequest("delete").expect(200);
    const shown = await retentionRequest("get").expect(200);

    expect(reset.body).toEqual(DEFAULT_RETENTION);
    expect(shown.body).toEqual(DEFAULT_RETENTION);
  });

  it("counts the Error Captures a shorter period would delete", async () => {
    const [{ id: usageLogId }] = await db
      .insert(usageLogs)
      .values({
        createdAt: new Date(),
        clientProtocol: "openai-chat",
        isStreamed: false,
        httpStatus: 502,
        requestBytes: 0,
        responseBytes: 0,
        durationMs: 1,
        attemptCount: 0,
      })
      .returning({ id: usageLogs.id });
    const capture = { usageLogId, requestHeaders: {}, requestBody: "{}" };
    await db.insert(errorCaptures).values(
      [10, 4, 1].map((ageDays) => ({
        ...capture,
        createdAt: new Date(Date.now() - ageDays * DAY_MS),
      })),
    );

    const response = await retentionRequest("get", "/impact?days=3").expect(200);

    expect(response.body).toEqual({ deleteCount: 2 });
  });

  it("lets only a User's session change Settings, never an API Key", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/api-keys")
      .set("Cookie", adaCookie)
      .send({ name: "CI" })
      .expect(201);

    await request(app.getHttpServer())
      .put("/api/settings/error-capture-retention")
      .set("Authorization", `Bearer ${created.body.key}`)
      .send({ days: 1 })
      .expect(401);
  });
});
