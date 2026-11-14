import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "../src/db/schemas/relations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "./support/test-app.js";

const FIRST_USER = { email: "ada@example.com", password: "correct horse battery" };

describe("Authentication (e2e)", () => {
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

  describe("first-run setup", () => {
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

  describe("login", () => {
    beforeEach(async () => {
      await setUpFirstUser(app, FIRST_USER);
    });

    it("sets an HTTP-only session cookie for the right password, with the email normalised", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "  ADA@Example.com ", password: FIRST_USER.password })
        .expect(200);

      expect(response.body.email).toBe(FIRST_USER.email);
      expect(response.get("Set-Cookie")?.[0]).toMatch(/HttpOnly/i);
    });

    it("answers a wrong password and an unknown email the same way", async () => {
      const server = app.getHttpServer();
      const wrongPassword = await request(server)
        .post("/api/auth/login")
        .send({ email: FIRST_USER.email, password: "wrong password" });
      const unknownEmail = await request(server)
        .post("/api/auth/login")
        .send({ email: "nobody@example.com", password: FIRST_USER.password });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(unknownEmail.body).toEqual(wrongPassword.body);
    });
  });

  it("logout ends the session", async () => {
    const server = app.getHttpServer();
    const cookie = await setUpFirstUser(app, FIRST_USER);

    await request(server).post("/api/auth/logout").set("Cookie", cookie).expect(204);

    await request(server).get("/api/auth/me").set("Cookie", cookie).expect(401);
  });

  it("refuses dashboard calls without a session", async () => {
    await setUpFirstUser(app, FIRST_USER);

    await request(app.getHttpServer()).get("/api/auth/me").expect(401);
    await request(app.getHttpServer()).get("/api/users").expect(401);
  });
});
