import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "../support/test-app.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const BLOCKED_BY_DEFAULT = { allowed: false, defaultAllowed: false, isDefault: true };

describe("Terms Risk Providers setting (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table settings`);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  function settingRequest(method: "get" | "put" | "delete") {
    return request(app.getHttpServer())
      [method]("/api/settings/terms-risk-providers")
      .set("Cookie", adaCookie);
  }

  it("blocks Terms Risk Providers until a User allows them", async () => {
    const response = await settingRequest("get").expect(200);

    expect(response.body).toEqual(BLOCKED_BY_DEFAULT);
  });

  it("saves the choice, shows it afterwards and returns to the default when reset", async () => {
    const saved = await settingRequest("put").send({ allowed: true }).expect(200);
    const shown = await settingRequest("get").expect(200);
    const reset = await settingRequest("delete").expect(200);
    const shownAfterReset = await settingRequest("get").expect(200);

    const allowed = { allowed: true, defaultAllowed: false, isDefault: false };
    expect(saved.body).toEqual(allowed);
    expect(shown.body).toEqual(allowed);
    expect(reset.body).toEqual(BLOCKED_BY_DEFAULT);
    expect(shownAfterReset.body).toEqual(BLOCKED_BY_DEFAULT);
  });

  it("rejects a body that is not a boolean", async () => {
    await settingRequest("put").send({ allowed: "yes" }).expect(400);
    await settingRequest("put").send({}).expect(400);

    expect((await settingRequest("get")).body).toEqual(BLOCKED_BY_DEFAULT);
  });
});
