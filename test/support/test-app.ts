import { PasswordHasher } from "@nestjs/authentication";
import { getDrizzleToken } from "@nestjs/drizzle";
import { NestNodeApplication, NodeAdapter } from "@nestjs/platform-node";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import type { Response } from "supertest";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import type { Database } from "../../src/db/relations.js";

// The production cost (logN 17) takes ~128 MiB and a noticeable time per hash.
const CHEAP_PASSWORD_HASHER = new PasswordHasher({ logN: 10 });

export interface TestApp {
  app: NestNodeApplication;
  db: Database;
}

/** Boots the whole AppModule against the e2e database, with cheap password hashing. */
export async function createTestApp(): Promise<TestApp> {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PasswordHasher)
    .useValue(CHEAP_PASSWORD_HASHER)
    .compile();
  const app = moduleFixture.createNestApplication<NestNodeApplication>(new NodeAdapter());
  configureApp(app);
  await app.init();
  return { app, db: app.get<Database>(getDrizzleToken()) };
}

/** Deletes every User, and with them their sessions. */
export async function deleteAllUsers(db: Database): Promise<void> {
  await db.execute(sql`truncate table users cascade`);
}

/** The `name=value` pair of the session cookie a response set, to send back as a `Cookie` header. */
export function sessionCookieOf(response: Response): string {
  const setCookie = response.get("Set-Cookie") ?? [];
  const sessionCookie = setCookie.find((cookie) => cookie.startsWith("__Host-sid="));
  if (!sessionCookie) {
    throw new Error(`Expected a session cookie, got: ${setCookie.join("; ")}`);
  }
  return sessionCookie.split(";")[0];
}

/** Runs first-run setup and returns the new User's session cookie. */
export async function setUpFirstUser(
  app: NestNodeApplication,
  credentials: { email: string; password: string },
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post("/api/auth/setup")
    .send(credentials)
    .expect(201);
  return sessionCookieOf(response);
}
