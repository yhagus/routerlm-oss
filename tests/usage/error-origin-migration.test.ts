import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { relations } from "@/db/schemas/relations.js";
import { createEmptyDatabase, dropDatabase } from "@tests/support/isolated-database.js";
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from "@tests/support/migrations.js";

const ERROR_ORIGIN_MIGRATION_SUFFIX = "_error_origin";

interface RecordedRequest {
  errorCode: string | null;
  httpStatus: number;
  isCancelled: boolean;
  attemptCount: number;
  expectedOrigin: "client" | "upstream" | "gateway" | null;
}

const RECORDED_REQUESTS: RecordedRequest[] = [
  {
    errorCode: "upstream_rate_limited",
    httpStatus: 429,
    isCancelled: false,
    attemptCount: 1,
    expectedOrigin: "upstream",
  },
  {
    errorCode: "upstream_error",
    httpStatus: 502,
    isCancelled: false,
    attemptCount: 2,
    expectedOrigin: "upstream",
  },
  {
    errorCode: "upstream_error",
    httpStatus: 503,
    isCancelled: false,
    attemptCount: 0,
    expectedOrigin: "upstream",
  },
  {
    errorCode: "upstream_timeout",
    httpStatus: 504,
    isCancelled: false,
    attemptCount: 1,
    expectedOrigin: "upstream",
  },
  {
    errorCode: "invalid_request",
    httpStatus: 400,
    isCancelled: false,
    attemptCount: 1,
    expectedOrigin: "upstream",
  },
  {
    errorCode: "invalid_request",
    httpStatus: 400,
    isCancelled: false,
    attemptCount: 0,
    expectedOrigin: "client",
  },
  {
    errorCode: null,
    httpStatus: 500,
    isCancelled: false,
    attemptCount: 1,
    expectedOrigin: "gateway",
  },
  {
    errorCode: "invalid_api_key",
    httpStatus: 401,
    isCancelled: false,
    attemptCount: 0,
    expectedOrigin: "client",
  },
  {
    errorCode: "model_not_allowed",
    httpStatus: 403,
    isCancelled: false,
    attemptCount: 0,
    expectedOrigin: "client",
  },
  {
    errorCode: "model_not_found",
    httpStatus: 404,
    isCancelled: false,
    attemptCount: 0,
    expectedOrigin: "client",
  },
  {
    errorCode: "no_capable_route",
    httpStatus: 400,
    isCancelled: false,
    attemptCount: 0,
    expectedOrigin: "client",
  },
  {
    errorCode: "request_too_large",
    httpStatus: 413,
    isCancelled: false,
    attemptCount: 0,
    expectedOrigin: "client",
  },
  {
    errorCode: "video_not_found",
    httpStatus: 404,
    isCancelled: false,
    attemptCount: 0,
    expectedOrigin: "client",
  },
  {
    errorCode: "video_not_ready",
    httpStatus: 409,
    isCancelled: false,
    attemptCount: 0,
    expectedOrigin: "client",
  },
  {
    errorCode: null,
    httpStatus: 404,
    isCancelled: false,
    attemptCount: 0,
    expectedOrigin: "client",
  },
  {
    errorCode: "upstream_error",
    httpStatus: 502,
    isCancelled: true,
    attemptCount: 1,
    expectedOrigin: null,
  },
  { errorCode: null, httpStatus: 200, isCancelled: true, attemptCount: 1, expectedOrigin: null },
  { errorCode: null, httpStatus: 200, isCancelled: false, attemptCount: 1, expectedOrigin: null },
];

describe("Error Origin migration (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(ERROR_ORIGIN_MIGRATION_SUFFIX);
    databaseUrl = await createEmptyDatabase(serverUrl, "error_origin");
    pool = new Pool({ connectionString: databaseUrl });
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: migrationsBefore });
  });

  afterAll(async () => {
    await pool.end();
    await dropDatabase(serverUrl, databaseUrl);
    await rm(migrationsBefore, { recursive: true, force: true });
  });

  async function insertRecordedRequest(request: RecordedRequest, position: number): Promise<void> {
    const createdAt = new Date(Date.UTC(2026, 10, 10, 10, 0, position)).toISOString();
    const { rows } = await pool.query<{ id: string }>(
      `insert into usage_logs (created_at, client_protocol, is_streamed, http_status, error_code,
         is_cancelled, request_bytes, response_bytes, duration_ms, attempt_count)
       values ($1, 'openai-chat', false, $2, $3, $4, 1, 1, 1, $5) returning id`,
      [createdAt, request.httpStatus, request.errorCode, request.isCancelled, request.attemptCount],
    );
    for (let attempt = 0; attempt < request.attemptCount; attempt++) {
      await pool.query(
        `insert into attempts (usage_log_id, started_at, duration_ms) values ($1, $2, 1)`,
        [rows[0].id, createdAt],
      );
    }
  }

  async function insertRecordedRequests(): Promise<void> {
    for (const [position, request] of RECORDED_REQUESTS.entries()) {
      await insertRecordedRequest(request, position);
    }
  }

  it("backfills the Error Origin of every existing failed Usage Log", async () => {
    await insertRecordedRequests();

    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });

    const { rows } = await pool.query<{ error_origin: string | null }>(
      `select error_origin from usage_logs order by created_at`,
    );
    expect(rows.map((row) => row.error_origin)).toEqual(
      RECORDED_REQUESTS.map((request) => request.expectedOrigin),
    );
  });
});
