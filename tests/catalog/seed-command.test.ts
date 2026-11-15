import { CommandBus } from "@nestjs/cqrs";
import { Test, TestingModule } from "@nestjs/testing";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { SeedCatalogCommand } from "@/catalog/commands/impl/seed-catalog.command.js";
import type { CatalogProvider } from "@/catalog/schemas/catalog.schema.js";
import { type Database, relations } from "@/db/schemas/relations.js";
import * as schema from "@/db/schemas/index.js";
import { createEmptyDatabase, dropDatabase } from "../support/isolated-database.js";

const source = { urls: ["https://example.com/pricing"], retrievedOn: "2026-11-15" };

const catalog: CatalogProvider[] = [
  {
    slug: "example",
    name: "Example",
    protocol: "openai-chat",
    baseUrl: "https://api.example.com/v1",
    authStyle: "bearer",
    quirks: { acceptsCacheControl: true },
    source,
    upstreamModels: [
      {
        upstreamModelId: "example-large",
        capabilities: ["tools", "vision"],
        contextSize: 200000,
        maxOutputTokens: 8192,
        inputPrice: 3,
        outputPrice: 15,
        cacheReadPrice: 0.3,
        cacheWritePrice: null,
        source,
      },
      {
        upstreamModelId: "example-small",
        capabilities: [],
        contextSize: 32000,
        maxOutputTokens: null,
        inputPrice: null,
        outputPrice: null,
        cacheReadPrice: null,
        cacheWritePrice: null,
        source,
      },
    ],
  },
];

describe("Seed Catalog command (e2e)", () => {
  const serverUrl = process.env.DATABASE_URL ?? "";
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let databaseUrl: string;
  let moduleRef: TestingModule;
  let commandBus: CommandBus;
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    databaseUrl = await createEmptyDatabase(serverUrl, "catalog_seed");
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle({ client: pool, relations });
    await migrate(db, { migrationsFolder: "./drizzle" });

    // ConfigModule.forRoot reads the environment when the module file is
    // evaluated, so the module is imported only after DATABASE_URL is set.
    process.env.DATABASE_URL = databaseUrl;
    const { CatalogSeedModule } = await import("@/catalog/catalog-seed.module.js");
    moduleRef = await Test.createTestingModule({ imports: [CatalogSeedModule] }).compile();
    await moduleRef.init();
    commandBus = moduleRef.get(CommandBus);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await pool?.end();
    process.env.DATABASE_URL = originalDatabaseUrl;
    if (databaseUrl) await dropDatabase(serverUrl, databaseUrl);
  });

  it("creates the Providers and Upstream Models on an empty database", async () => {
    await commandBus.execute(new SeedCatalogCommand(catalog));

    const provider = await db.query.providers.findFirst({
      where: { slug: "example" },
      with: { upstreamModels: { orderBy: { upstreamModelId: "asc" } } },
    });
    expect(provider).toMatchObject({
      name: "Example",
      protocol: "openai-chat",
      baseUrl: "https://api.example.com/v1",
      authStyle: "bearer",
      quirks: { acceptsCacheControl: true },
      isEnabled: true,
      isFromCatalog: true,
    });
    expect(provider?.upstreamModels).toMatchObject([
      {
        upstreamModelId: "example-large",
        capabilities: ["tools", "vision"],
        contextSize: 200000,
        maxOutputTokens: 8192,
        inputPrice: 3,
        outputPrice: 15,
        cacheReadPrice: 0.3,
        cacheWritePrice: null,
      },
      { upstreamModelId: "example-small", inputPrice: null, maxOutputTokens: null },
    ]);
  });

  it("keeps an operator's edits and creates nothing new when run again", async () => {
    await db
      .update(schema.providers)
      .set({ baseUrl: "https://proxy.internal/v1", isEnabled: false })
      .where(eq(schema.providers.slug, "example"));
    await db
      .update(schema.upstreamModels)
      .set({ inputPrice: 2.5 })
      .where(eq(schema.upstreamModels.upstreamModelId, "example-large"));

    await commandBus.execute(new SeedCatalogCommand(catalog));

    const provider = await db.query.providers.findFirst({
      where: { slug: "example" },
      with: { upstreamModels: true },
    });
    expect(provider).toMatchObject({ baseUrl: "https://proxy.internal/v1", isEnabled: false });
    expect(provider?.upstreamModels).toHaveLength(2);
    expect(provider?.upstreamModels).toContainEqual(
      expect.objectContaining({ upstreamModelId: "example-large", inputPrice: 2.5 }),
    );
  });

  it("creates no Provider Accounts, Models or Routes", async () => {
    const [accounts] = await db.select({ total: count() }).from(schema.providerAccounts);
    const [models] = await db.select({ total: count() }).from(schema.models);
    const [routes] = await db.select({ total: count() }).from(schema.routes);

    expect([accounts?.total, models?.total, routes?.total]).toEqual([0, 0, 0]);
  });
});
