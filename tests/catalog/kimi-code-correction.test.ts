import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import request from "supertest";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";
import { type Database, relations } from "@/db/schemas/relations.js";
import { createEmptyDatabase, dropDatabase } from "@tests/support/isolated-database.js";
import { copyMigrationsBefore, MIGRATIONS_FOLDER } from "@tests/support/migrations.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";

const CORRECTION_MIGRATION_SUFFIX = "_correct_kimi_code_base_url_and_context_sizes";
const OAUTH_LOGIN_OFFER_MIGRATION_SUFFIX = "_offer_kimi_code_oauth_login";
const OPERATOR = { email: "ops@example.com", password: "ops password" };

const OLD_BASE_URL = "https://api.kimi.ai/coding/v1";
const OLD_CONTEXT_SIZE = 1048576;

type OldKimiCode = {
  baseUrl: string;
  contextSizes: Record<string, number>;
  quirks?: Record<string, unknown>;
  quotaReader?: string;
  oauthLogin?: Record<string, unknown>;
};
type KimiCodeFromApi = {
  id: string;
  baseUrl: string | undefined;
  contextSizes: Record<string, number>;
  quirks: Record<string, unknown>;
  quotaReader: string | null;
  oauthLogin: Record<string, unknown> | null;
};

describe("Kimi Code correction migration (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let migrationsBeforeCorrection: string;
  let migrationsBeforeOauthLoginOffer: string;
  const opened: { databaseUrl: string; pool: Pool }[] = [];

  beforeAll(async () => {
    migrationsBeforeCorrection = await copyMigrationsBefore(CORRECTION_MIGRATION_SUFFIX);
    migrationsBeforeOauthLoginOffer = await copyMigrationsBefore(
      OAUTH_LOGIN_OFFER_MIGRATION_SUFFIX,
    );
  });

  afterAll(async () => {
    for (const { pool, databaseUrl } of opened) {
      await pool.end();
      await dropDatabase(serverUrl, databaseUrl);
    }
    for (const folder of [migrationsBeforeCorrection, migrationsBeforeOauthLoginOffer]) {
      if (folder) await rm(folder, { recursive: true, force: true });
    }
  });

  async function upgradeInstallHolding(
    oldKimiCode: OldKimiCode,
  ): Promise<{ db: Database; providerId: string }> {
    const databaseUrl = await createEmptyDatabase(serverUrl, "kimi_code_correction");
    const pool = new Pool({ connectionString: databaseUrl });
    opened.push({ databaseUrl, pool });
    const db = drizzle({ client: pool, relations });
    await migrate(db, { migrationsFolder: migrationsBeforeCorrection });
    const providerId = await insertKimiCode(pool, oldKimiCode);
    if (oldKimiCode.oauthLogin !== undefined) {
      await migrate(db, { migrationsFolder: migrationsBeforeOauthLoginOffer });
      await pool.query(`update providers set oauth_login = $1 where id = $2`, [
        JSON.stringify(oldKimiCode.oauthLogin),
        providerId,
      ]);
    }
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return { db, providerId };
  }

  it("moves an untouched Kimi Code Provider to the new base URL and today's context sizes", async () => {
    const { db, providerId } = await upgradeInstallHolding({
      baseUrl: OLD_BASE_URL,
      contextSizes: {
        "k3.1-pro": OLD_CONTEXT_SIZE,
        "k3.1-pro-highspeed": OLD_CONTEXT_SIZE,
        k3: OLD_CONTEXT_SIZE,
      },
    });

    const kimiCode = await readKimiCodeThroughApi(db);

    expect(kimiCode).toMatchObject({
      id: providerId,
      baseUrl: "https://api.kimi.com/coding/v1",
      contextSizes: { "k3.1-pro": 1048576, "k3.1-pro-highspeed": 1048576, k3: 1048576 },
    });
  });

  it("keeps a base URL and a context size the operator edited", async () => {
    const { db } = await upgradeInstallHolding({
      baseUrl: "https://kimi-proxy.example/coding/v1",
      contextSizes: { "k3.1-pro": 524288, k3: OLD_CONTEXT_SIZE },
    });

    const kimiCode = await readKimiCodeThroughApi(db);

    expect(kimiCode).toMatchObject({
      baseUrl: "https://kimi-proxy.example/coding/v1",
      contextSizes: { "k3.1-pro": 524288, k3: 1048576 },
    });
  });

  it("gives an untouched Kimi Code Provider the Catalog's quirks", async () => {
    const { db } = await upgradeInstallHolding({ baseUrl: OLD_BASE_URL, contextSizes: {} });

    const kimiCode = await readKimiCodeThroughApi(db);

    expect(kimiCode.quirks).toEqual(await catalogKimiCodeQuirks());
  });

  it("keeps quirks the operator edited", async () => {
    const { db } = await upgradeInstallHolding({
      baseUrl: OLD_BASE_URL,
      contextSizes: {},
      quirks: { usesMaxCompletionTokens: true },
    });

    const kimiCode = await readKimiCodeThroughApi(db);

    expect(kimiCode.quirks).toEqual({ usesMaxCompletionTokens: true });
  });

  it("names the Kimi Code quota reader on an untouched Kimi Code Provider", async () => {
    const { db } = await upgradeInstallHolding({ baseUrl: OLD_BASE_URL, contextSizes: {} });

    const kimiCode = await readKimiCodeThroughApi(db);

    expect(kimiCode.quotaReader).toBe("kimi-code");
  });

  it("keeps a quota reader the operator set", async () => {
    const { db } = await upgradeInstallHolding({
      baseUrl: OLD_BASE_URL,
      contextSizes: {},
      quotaReader: "minimax-m-plan",
    });

    const kimiCode = await readKimiCodeThroughApi(db);

    expect(kimiCode.quotaReader).toBe("minimax-m-plan");
  });

  it("lets an untouched Kimi Code Provider offer OAuth Login", async () => {
    const { db } = await upgradeInstallHolding({ baseUrl: OLD_BASE_URL, contextSizes: {} });

    const kimiCode = await readKimiCodeThroughApi(db);

    expect(kimiCode.oauthLogin).toEqual({
      flow: "kimi-code",
      authHosts: { global: "https://auth.kimi.ai", china: "https://auth.kimi.com" },
      clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
      cliVersion: "2.6.2",
    });
    expect(kimiCode.oauthLogin).toEqual(await catalogKimiCodeOauthLogin());
  });

  it("keeps OAuth Login data the operator set, keyed by the kimi-code flow", async () => {
    const operatorOauthLogin = {
      authHosts: { global: "https://auth.kimi-proxy.example", china: "https://auth.kimi.com" },
      clientId: "client-id-the-operator-set",
      cliVersion: "3.0.0",
    };
    const { db } = await upgradeInstallHolding({
      baseUrl: OLD_BASE_URL,
      contextSizes: {},
      oauthLogin: operatorOauthLogin,
    });

    const kimiCode = await readKimiCodeThroughApi(db);

    expect(kimiCode.oauthLogin).toEqual({ flow: "kimi-code", ...operatorOauthLogin });
  });
});

async function catalogKimiCodeOauthLogin(): Promise<unknown> {
  const catalog = await loadCatalog(CATALOG_DIRECTORY);
  return catalog.find((provider) => provider.slug === "kimi-code")?.oauthLogin;
}

async function catalogKimiCodeQuirks(): Promise<Record<string, unknown>> {
  const catalog = await loadCatalog(CATALOG_DIRECTORY);
  const kimiCode = catalog.find((provider) => provider.slug === "kimi-code");
  if (!kimiCode) throw new Error("the Catalog has no Kimi Code Provider");
  return kimiCode.quirks;
}

async function insertKimiCode(
  pool: Pool,
  { baseUrl, contextSizes, quirks = {}, quotaReader }: OldKimiCode,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into providers
       (slug, name, protocol, base_url, auth_style, quirks, quota_reader, is_from_catalog)
     values ('kimi-code', 'Kimi Code', 'openai-chat', $1, 'bearer', $2, $3, true)
     returning id`,
    [baseUrl, JSON.stringify(quirks), quotaReader ?? null],
  );
  const providerId = rows[0]?.id;
  if (providerId === undefined) throw new Error("the Kimi Code Provider was not inserted");

  for (const [upstreamModelId, contextSize] of Object.entries(contextSizes)) {
    await pool.query(
      `insert into upstream_models (provider_id, upstream_model_id, context_size)
       values ($1, $2, $3)`,
      [providerId, upstreamModelId, contextSize],
    );
  }
  return providerId;
}

async function readKimiCodeThroughApi(db: Database): Promise<KimiCodeFromApi> {
  const { app } = await createTestApp(db);
  try {
    const cookie = await setUpFirstUser(app, OPERATOR);
    const server = app.getHttpServer();
    const providers = await request(server).get("/api/providers").set("Cookie", cookie).expect(200);
    const upstreamModels = await request(server)
      .get("/api/upstream-models")
      .set("Cookie", cookie)
      .expect(200);

    const providerRows: {
      id: string;
      slug: string;
      endpoints: { kind: string; baseUrl: string }[];
      quirks: Record<string, unknown>;
      quotaReader: string | null;
      oauthLogin: Record<string, unknown> | null;
    }[] = providers.body;
    const upstreamModelRows: { upstreamModelId: string; contextSize: number }[] =
      upstreamModels.body;
    const kimiCode = providerRows.find((provider) => provider.slug === "kimi-code");
    if (!kimiCode) throw new Error("the API lists no Kimi Code Provider");

    return {
      id: kimiCode.id,
      baseUrl: kimiCode.endpoints.find((endpoint) => endpoint.kind === "chat")?.baseUrl,
      quirks: kimiCode.quirks,
      quotaReader: kimiCode.quotaReader,
      oauthLogin: kimiCode.oauthLogin,
      contextSizes: Object.fromEntries(
        upstreamModelRows.map((model) => [model.upstreamModelId, model.contextSize]),
      ),
    };
  } finally {
    await app.close();
  }
}
