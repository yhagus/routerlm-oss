import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { RedisConnection } from "@/redis/providers/redis-connection.js";
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

const LOGINS_PER_MINUTE = 10;
const WRONG_LOGIN = { email: "nobody@example.com", password: "wrong password" };

function loginFrom(app: NestNodeApplication, forwardedFor: string) {
  return request(app.getHttpServer())
    .post("/api/auth/login")
    .set("X-Forwarded-For", forwardedFor)
    .send(WRONG_LOGIN);
}

async function attemptLogins(app: NestNodeApplication, forwardedFor: string, count: number) {
  for (let attempt = 0; attempt < count; attempt++) {
    await loginFrom(app, forwardedFor);
  }
}

async function forgetLoginAttempts(app: NestNodeApplication): Promise<void> {
  const { client } = app.get(RedisConnection);
  const keys = await client.keys("routerlm:throttle:*");
  if (keys.length > 0) await client.del(...keys);
}

describe("Authentication: login throttling behind a trusted proxy (e2e)", () => {
  let app: NestNodeApplication;

  beforeAll(async () => {
    process.env.TRUST_PROXY = "true";
    ({ app } = await createTestApp());
  });

  beforeEach(async () => {
    await forgetLoginAttempts(app);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.TRUST_PROXY;
  });

  it("answers 429 to the 11th login in a minute from one IP and still serves another IP", async () => {
    await attemptLogins(app, "203.0.113.1", LOGINS_PER_MINUTE);

    const eleventh = await loginFrom(app, "203.0.113.1");
    const otherClient = await loginFrom(app, "203.0.113.2");

    expect(eleventh.status).toBe(429);
    expect(otherClient.status).toBe(401);
  });

  it("shares the count between two instances through Redis", async () => {
    const { app: secondInstance } = await createTestApp();
    try {
      await attemptLogins(app, "203.0.113.3", LOGINS_PER_MINUTE / 2);
      await attemptLogins(secondInstance, "203.0.113.3", LOGINS_PER_MINUTE / 2);

      const eleventh = await loginFrom(app, "203.0.113.3");

      expect(eleventh.status).toBe(429);
    } finally {
      await secondInstance.close();
    }
  });

  it("does not throttle /v1", async () => {
    const server = app.getHttpServer();
    for (let attempt = 0; attempt <= LOGINS_PER_MINUTE; attempt++) {
      await request(server).get("/v1/models").set("X-Forwarded-For", "203.0.113.4").expect(401);
    }
  });

  it("keeps login working when Redis is unavailable", async () => {
    const { app: instance } = await createTestApp();
    try {
      instance.get(RedisConnection).client.disconnect();
      await attemptLogins(instance, "203.0.113.5", LOGINS_PER_MINUTE);

      const response = await loginFrom(instance, "203.0.113.5");

      expect(response.status).toBe(401);
    } finally {
      await instance.close();
    }
  });
});

describe("Authentication: login throttling without a trusted proxy (e2e)", () => {
  let app: NestNodeApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  beforeEach(async () => {
    await forgetLoginAttempts(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("ignores a forged X-Forwarded-For", async () => {
    await attemptLogins(app, "203.0.113.10", LOGINS_PER_MINUTE);

    const withAnotherForgedAddress = await loginFrom(app, "203.0.113.11");

    expect(withAnotherForgedAddress.status).toBe(429);
  });
});
