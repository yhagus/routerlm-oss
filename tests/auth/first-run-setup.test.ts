import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "../support/test-app.js";

const FIRST_USER = { email: "ada@example.com", password: "correct horse battery" };

describe("Authentication: first-run setup (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUsers(db);
  });

  afterAll(async () => {
    await app.close();
  });

  it("is required while no User exists, and refused once one does", async () => {
    const server = app.getHttpServer();
    await request(server).get("/api/auth/setup").expect(200, { isSetupRequired: true });

    const response = await request(server).post("/api/auth/setup").send(FIRST_USER).expect(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      email: FIRST_USER.email,
      createdById: null,
      createdAt: expect.any(String),
    });

    await request(server).get("/api/auth/setup").expect(200, { isSetupRequired: false });
    await request(server)
      .post("/api/auth/setup")
      .send({ email: "mallory@example.com", password: "another password" })
      .expect(409);
  });

  it("signs the first User in", async () => {
    const cookie = await setUpFirstUser(app, FIRST_USER);

    const me = await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie);

    expect(me.status).toBe(200);
    expect(me.body.email).toBe(FIRST_USER.email);
  });

  it("rejects an invalid payload", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/setup")
      .send({ email: "not-an-email", password: "short" })
      .expect(400);
  });
});
