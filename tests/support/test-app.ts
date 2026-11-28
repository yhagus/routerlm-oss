import { PasswordHasher } from '@nestjs/authentication';
import type { INestApplicationContext } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { Response } from 'supertest';
import request from 'supertest';
import { AppModule } from '@/app.module';
import type { BackendRole } from '@/config/schemas/env.schema';
import { configureApp, createNodeAdapter } from '@/configure-app';
import type { Database } from '@/db/schemas/relations';
import { allowPrivateUpstreams } from './private-upstreams';
import { truncateTables } from './truncate';

const CHEAP_PASSWORD_HASHER = new PasswordHasher({ logN: 10 });

export interface TestApp {
  app: NestNodeApplication;
  db: Database;
}

export async function createTestApp(
  database?: Database,
  {
    allowsPrivateUpstreams = true,
    role = 'all',
  }: { allowsPrivateUpstreams?: boolean; role?: BackendRole } = {},
): Promise<TestApp> {
  const moduleBuilder = Test.createTestingModule({ imports: [AppModule.forRole(role)] })
    .overrideProvider(PasswordHasher)
    .useValue(CHEAP_PASSWORD_HASHER);
  if (database) moduleBuilder.overrideProvider(getDrizzleToken()).useValue(database);
  const moduleFixture = await moduleBuilder.compile();
  const app = moduleFixture.createNestApplication<NestNodeApplication>(createNodeAdapter());
  configureApp(app);
  await app.init();
  if (allowsPrivateUpstreams) await allowPrivateUpstreams(app, true);
  return { app, db: app.get<Database>(getDrizzleToken()) };
}

export async function deleteAllUsers(app: INestApplicationContext): Promise<void> {
  await truncateTables(app, sql.raw('users'));
}

export function sessionCookieOf(response: Response): string {
  const setCookie = response.get('Set-Cookie') ?? [];
  const sessionCookie = setCookie.find((cookie) => cookie.startsWith('__Host-sid='));
  if (!sessionCookie) {
    throw new Error(`Expected a session cookie, got: ${setCookie.join('; ')}`);
  }
  return sessionCookie.split(';')[0];
}

export async function setUpFirstUser(
  app: NestNodeApplication,
  credentials: { email: string; password: string },
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/auth/setup')
    .send(credentials)
    .expect(201);
  return sessionCookieOf(response);
}
