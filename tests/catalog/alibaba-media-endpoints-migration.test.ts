import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { relations } from "@/db/schemas/relations.js";
import { createEmptyDatabase, dropDatabase } from "../support/isolated-database.js";
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from "../support/migrations.js";

const MEDIA_ENDPOINTS_MIGRATION_SUFFIX = "_give_alibaba_its_media_endpoints";
const NATIVE_API = "https://dashscope-intl.aliyuncs.com/api/v1";
const CHAT_ENDPOINT = {
  kind: "chat",
  protocol: "openai-chat",
  baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
};

describe("Alibaba media endpoints migration (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let migrationsBefore: string;
  let databaseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    migrationsBefore = await copyMigrationsBefore(MEDIA_ENDPOINTS_MIGRATION_SUFFIX);
  });

  beforeEach(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, "alibaba_media_endpoints");
    pool = new Pool({ connectionString: databaseUrl });
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: migrationsBefore });
  });

  afterEach(async () => {
    await pool.end();
    await dropDatabase(serverUrl, databaseUrl);
  });

  afterAll(async () => {
    await rm(migrationsBefore, { recursive: true, force: true });
  });

  /** The Alibaba Provider as the seeder created it before the Catalog had media endpoints. */
  async function insertSeededAlibaba(endpoints: unknown[]): Promise<void> {
    await pool.query(
      `insert into providers (slug, name, endpoints, auth_style, is_from_catalog)
       values ('alibaba-model-studio-intl', 'Alibaba Model Studio (International)', $1, 'bearer', true)`,
      [JSON.stringify(endpoints)],
    );
  }

  async function migrateToLatest(): Promise<void> {
    await migrate(drizzle({ client: pool, relations }), { migrationsFolder: MIGRATIONS_FOLDER });
  }

  async function readEndpoints(): Promise<unknown> {
    const { rows } = await pool.query<{ endpoints: unknown }>(
      `select endpoints from providers where slug = 'alibaba-model-studio-intl'`,
    );
    return rows[0]?.endpoints;
  }

  it("adds the image, speech, transcription and video endpoints to a seeded Provider", async () => {
    await insertSeededAlibaba([CHAT_ENDPOINT]);

    await migrateToLatest();

    expect(await readEndpoints()).toEqual([
      CHAT_ENDPOINT,
      { kind: "image", protocol: "dashscope-image", baseUrl: NATIVE_API },
      { kind: "speech", protocol: "dashscope-speech", baseUrl: NATIVE_API },
      { kind: "transcription", protocol: "dashscope-transcription", baseUrl: NATIVE_API },
      { kind: "video", protocol: "dashscope-video", baseUrl: NATIVE_API },
    ]);
  });

  it("keeps an endpoint the Provider already has for a media Kind", async () => {
    const workspaceImage = {
      kind: "image",
      protocol: "dashscope-image",
      baseUrl: "https://workspace.example.com/api/v1",
    };
    await insertSeededAlibaba([CHAT_ENDPOINT, workspaceImage]);

    await migrateToLatest();

    expect(await readEndpoints()).toEqual([
      CHAT_ENDPOINT,
      workspaceImage,
      { kind: "speech", protocol: "dashscope-speech", baseUrl: NATIVE_API },
      { kind: "transcription", protocol: "dashscope-transcription", baseUrl: NATIVE_API },
      { kind: "video", protocol: "dashscope-video", baseUrl: NATIVE_API },
    ]);
  });
});
