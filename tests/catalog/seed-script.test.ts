import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { type Database, relations } from "@/db/schemas/relations.js";
import { providers, upstreamModels } from "@/db/schemas/index.js";
import { createEmptyDatabase, dropDatabase } from "../support/isolated-database.js";

const runFile = promisify(execFile);
// Bun startup plus seeding every shipped Catalog file.
const SEED_TIMEOUT_MS = 30_000;

describe("db:seed script (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  let databaseUrl: string;
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, "seed_script");
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle({ client: pool, relations });
    await migrate(db, { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    await pool?.end();
    if (databaseUrl) await dropDatabase(serverUrl, databaseUrl);
  });

  it(
    "seeds a Provider for every Catalog file shipped with the gateway",
    async () => {
      // A DATABASE_URL in the environment wins over the one in the developer's .env.
      await runFile("bun", ["src/seed.ts"], {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: SEED_TIMEOUT_MS,
      });

      const seeded = await db.select({ slug: providers.slug }).from(providers);
      expect(seeded.map((provider) => provider.slug).sort()).toEqual([
        "alibaba-model-studio-intl",
        "anthropic",
        "deepseek",
        "kimi-code",
        "minimax-api",
        "minimax-m-plan",
        "moonshot",
        "openai",
        "openai-codex",
        "xiaomi-mimo",
      ]);
    },
    SEED_TIMEOUT_MS,
  );

  it("seeds Kimi Code on api.kimi.com with the context sizes Kimi serves", async () => {
    const [kimiCode] = await db.select().from(providers).where(eq(providers.slug, "kimi-code"));
    const kimiCodeModels = await db
      .select({ id: upstreamModels.upstreamModelId, contextSize: upstreamModels.contextSize })
      .from(upstreamModels)
      .where(eq(upstreamModels.providerId, kimiCode?.id ?? ""));

    expect(kimiCode?.baseUrl).toBe("https://api.kimi.com/coding/v1");
    expect(
      Object.fromEntries(kimiCodeModels.map((model) => [model.id, model.contextSize])),
    ).toEqual({
      "k3.1-pro": 262144,
      "k3.1-pro-highspeed": 1048576,
      k3: 262144,
      "k3-256k": 262144,
      "kimi-for-coding": 1048576,
      "kimi-for-coding-highspeed": 262144,
    });
  });
  it("seeds OpenAI Codex on the Responses Protocol, accepting only an OAuth Login", async () => {
    const [codex] = await db.select().from(providers).where(eq(providers.slug, "openai-codex"));
    const [openAi] = await db.select().from(providers).where(eq(providers.slug, "openai"));
    const codexModels = await db
      .select({ id: upstreamModels.upstreamModelId, contextSize: upstreamModels.contextSize })
      .from(upstreamModels)
      .where(eq(upstreamModels.providerId, codex?.id ?? ""));

    expect(codex).toMatchObject({
      protocol: "openai-responses",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      credentialKinds: ["oauth-login"],
    });
    expect(openAi).toMatchObject({
      protocol: "openai-chat",
      credentialKinds: ["api-key", "oauth-login"],
    });
    expect(Object.fromEntries(codexModels.map((model) => [model.id, model.contextSize]))).toEqual({
      "gpt-6-astra": 500000,
      "gpt-6.1-sol": 500000,
      "gpt-6.1-terra": 500000,
      "gpt-6-sol": 272000,
      "gpt-6-luna": 272000,
      "gpt-5.6-sol": 272000,
      "gpt-5.6-terra": 272000,
      "gpt-5.6-luna": 272000,
      "gpt-5.5": 272000,
    });
  });
});
