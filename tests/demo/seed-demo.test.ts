import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import request from "supertest";
import { type Database, relations } from "@/db/schemas/relations.js";
import { usageLogs } from "@/db/schemas/index.js";
import { createEmptyDatabase, dropDatabase } from "../support/isolated-database.js";
import { MIGRATIONS_FOLDER } from "../support/migrations.js";
import { createTestApp, sessionCookieOf } from "../support/test-app.js";

const runFile = promisify(execFile);
// Bun startup, the Catalog, one production-cost password hash and the bulk inserts.
const SEED_TIMEOUT_MS = 60_000;

const DEMO_CREDENTIALS = { email: "admin@example.com", password: "routerlm-demo" };
const DEMO_REQUEST_COUNT = 1_750;

describe("db:seed:demo script (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let databaseUrl: string;
  let pool: Pool;
  let db: Database;
  let app: NestNodeApplication | undefined;

  function seedDemo(targetUrl: string) {
    // A DATABASE_URL in the environment wins over the one in the developer's .env.
    return runFile("bun", ["src/seed-demo.ts"], {
      env: { ...process.env, DATABASE_URL: targetUrl },
      timeout: SEED_TIMEOUT_MS,
    });
  }

  beforeAll(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, "seed", "_demo");
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle({ client: pool, relations });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (databaseUrl) await dropDatabase(serverUrl, databaseUrl);
  });

  it("refuses a database whose name doesn't end in _demo", async () => {
    await expect(seedDemo(serverUrl)).rejects.toMatchObject({
      stderr: expect.stringContaining("must end in _demo"),
    });
  });

  it(
    "fills the demo database once, however often it runs",
    async () => {
      await seedDemo(databaseUrl);
      await seedDemo(databaseUrl);

      const [{ usageLogCount }] = await db.select({ usageLogCount: count() }).from(usageLogs);
      expect(usageLogCount).toBe(DEMO_REQUEST_COUNT);
    },
    2 * SEED_TIMEOUT_MS,
  );

  it("signs the demo User in to an Overview with a week of traffic", async () => {
    ({ app } = await createTestApp(db));
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send(DEMO_CREDENTIALS)
      .expect(200);

    const overview = await request(app.getHttpServer())
      .get("/api/overview?range=7d")
      .set("Cookie", sessionCookieOf(login))
      .expect(200);

    expect(overview.body.totals.requestCount).toBeGreaterThan(DEMO_REQUEST_COUNT * 0.9);
    expect(overview.body.totals.cost).toBeGreaterThan(0);
    expect(overview.body.totals.errorRate).toBeGreaterThan(0);
    expect(overview.body.totals.errorRate).toBeLessThan(0.05);
  });
});
