import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations";
import {
  createTestApp,
  deleteAllUsers,
  sessionCookieOf,
  setUpFirstUser,
} from "@tests/support/test-app";

const ADA = { email: "ada@example.com", password: "ada's password" };
const GRACE = { email: "grace@example.com", password: "grace's password" };

describe("Users (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createGrace(): Promise<{ id: string; cookie: string }> {
    const server = app.getHttpServer();
    const created = await request(server)
      .post("/api/users")
      .set("Cookie", adaCookie)
      .send(GRACE)
      .expect(201);
    const login = await request(server).post("/api/auth/login").send(GRACE).expect(200);
    return { id: created.body.id, cookie: sessionCookieOf(login) };
  }

  it("creates a User and lists it, without password hashes", async () => {
    const grace = await createGrace();

    const list = await request(app.getHttpServer())
      .get("/api/users")
      .set("Cookie", adaCookie)
      .expect(200);

    expect(list.body).toEqual([
      {
        id: expect.any(String),
        email: ADA.email,
        createdById: null,
        createdAt: expect.any(String),
      },
      {
        id: grace.id,
        email: GRACE.email,
        createdById: list.body[0].id,
        createdAt: expect.any(String),
      },
    ]);
  });

  it("refuses a second User with the same email, whatever its case", async () => {
    await request(app.getHttpServer())
      .post("/api/users")
      .set("Cookie", adaCookie)
      .send({ email: "ADA@example.com", password: "another password" })
      .expect(409);
  });

  it("resets another User's password and signs them out", async () => {
    const server = app.getHttpServer();
    const grace = await createGrace();

    await request(server)
      .put(`/api/users/${grace.id}/password`)
      .set("Cookie", adaCookie)
      .send({ password: "a new password" })
      .expect(204);

    await request(server).get("/api/auth/me").set("Cookie", grace.cookie).expect(401);
    await request(server).post("/api/auth/login").send(GRACE).expect(401);
    await request(server)
      .post("/api/auth/login")
      .send({ email: GRACE.email, password: "a new password" })
      .expect(200);
  });

  it("deletes another User and ends their session", async () => {
    const server = app.getHttpServer();
    const grace = await createGrace();

    await request(server).delete(`/api/users/${grace.id}`).set("Cookie", adaCookie).expect(204);

    await request(server).get("/api/auth/me").set("Cookie", grace.cookie).expect(401);
  });

  it("refuses to delete the last User", async () => {
    const server = app.getHttpServer();
    const me = await request(server).get("/api/auth/me").set("Cookie", adaCookie).expect(200);

    await request(server).delete(`/api/users/${me.body.id}`).set("Cookie", adaCookie).expect(409);
  });
});
