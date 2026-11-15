import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "../support/test-app.js";

const FIRST_USER = { email: "ada@example.com", password: "correct horse battery" };

describe("Authentication: login (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUsers(db);
    await setUpFirstUser(app, FIRST_USER);
  });

  afterAll(async () => {
    await app.close();
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
