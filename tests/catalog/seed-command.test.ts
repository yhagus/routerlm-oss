import { Logger } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { Test, TestingModule } from "@nestjs/testing";
import { asc, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { SeedCatalogCommand } from "@/catalog/commands/impl/seed-catalog.command";
import type {
  CatalogPricingWindow,
  CatalogProvider,
  CatalogUpstreamModel,
} from "@/catalog/schemas/catalog.schema";
import { type Database, relations } from "@/db/schemas/relations";
import * as schema from "@/db/schemas";
import type { PricingWindowRange } from "@/db/schemas";
import { createEmptyDatabase, dropDatabase } from "@tests/support/isolated-database";

const source = { urls: ["https://example.com/pricing"], retrievedOn: "2026-11-15" };

const oauthLogin = {
  flow: "kimi-code" as const,
  authHosts: { global: "https://auth.example.com", china: "https://auth.example.cn" },
  clientId: "example-cli",
  cliVersion: "1.2.3",
};

const UNIT_PRICES_AND_LIMITS = {
  pricePerImage: 0.03,
  pricePerImageBySize: { "1K": 0.04, "2K": 0.075 },
  pricePerInputImage: 0.003,
  pricePerSecondByResolution: { "720P": 0.1 },
  pricePerMillionCharacters: 20,
  pricePerAudioSecond: 0.000035,
  maxInputImages: 9,
  minDurationSeconds: 2,
  maxDurationSeconds: 30,
  resolutions: ["720P"],
  sizes: ["1024*1024"],
};

const catalog: CatalogProvider[] = [
  {
    slug: "example",
    name: "Example",
    logo: "example",
    termsRisk: true,
    endpoints: [{ kind: "chat", protocol: "openai-chat", baseUrl: "https://api.example.com/v1" }],
    authStyle: "bearer",
    quirks: { acceptsCacheControl: true },
    oauthLogin,
    source,
    upstreamModels: [
      {
        upstreamModelId: "example-large",
        name: "Example Large",
        capabilities: ["tools", "vision"],
        contextSize: 200000,
        maxOutputTokens: 8192,
        inputPrice: 3,
        outputPrice: 15,
        cacheReadPrice: 0.3,
        cacheWritePrice: null,
        releaseDate: "2026-03-01",
        source,
      },
      {
        upstreamModelId: "example-small",
        name: "Example Small",
        capabilities: [],
        contextSize: 32000,
        maxOutputTokens: null,
        inputPrice: null,
        outputPrice: null,
        cacheReadPrice: null,
        cacheWritePrice: null,
        ...UNIT_PRICES_AND_LIMITS,
        releaseDate: "2025-09-15",
        source,
      },
    ],
  },
];

const NIGHT: CatalogPricingWindow = {
  name: "Example Night",
  timeZone: "UTC",
  ranges: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], start: "22:00", end: "08:00" }],
};
const LUNCH: CatalogPricingWindow = {
  name: "Example Lunch",
  timeZone: "UTC",
  ranges: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], start: "12:00", end: "13:00" }],
};

function windowedModel(
  upstreamModelId: string,
  windowPrices: CatalogUpstreamModel["windowPrices"],
) {
  return {
    upstreamModelId,
    name: upstreamModelId,
    capabilities: [],
    contextSize: 32000,
    maxOutputTokens: null,
    inputPrice: 2,
    outputPrice: 8,
    cacheReadPrice: null,
    cacheWritePrice: null,
    releaseDate: "2026-01-01",
    source,
    windowPrices,
  };
}

const windowedCatalog: CatalogProvider[] = [
  {
    ...catalog[0],
    slug: "windowed",
    name: "Windowed",
    pricingWindows: [NIGHT],
    upstreamModels: [
      windowedModel("windowed-large", [
        { pricingWindow: NIGHT.name, inputPrice: 1, outputPrice: 4 },
      ]),
      windowedModel("windowed-small", [{ pricingWindow: NIGHT.name, inputPrice: 0.5 }]),
    ],
  },
];

const windowedCatalogWithLunch: CatalogProvider[] = [
  {
    ...windowedCatalog[0],
    pricingWindows: [NIGHT, LUNCH],
    upstreamModels: [
      windowedModel("windowed-large", [
        { pricingWindow: NIGHT.name, inputPrice: 1, outputPrice: 4 },
        { pricingWindow: LUNCH.name, cacheReadPrice: 0.1 },
      ]),
      windowedModel("windowed-small", [
        { pricingWindow: NIGHT.name, inputPrice: 0.5 },
        { pricingWindow: LUNCH.name, inputPrice: 0.25 },
      ]),
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

    process.env.DATABASE_URL = databaseUrl;
    const { CatalogSeedModule } = await import("@/catalog/catalog-seed.module");
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
      logo: "example",
      termsRisk: true,
      endpoints: [{ kind: "chat", protocol: "openai-chat", baseUrl: "https://api.example.com/v1" }],
      authStyle: "bearer",
      quirks: { acceptsCacheControl: true },
      oauthLogin,
      isEnabled: true,
      isFromCatalog: true,
    });
    expect(provider?.upstreamModels).toMatchObject([
      {
        upstreamModelId: "example-large",
        name: "Example Large",
        capabilities: ["tools", "vision"],
        contextSize: 200000,
        maxOutputTokens: 8192,
        inputPrice: 3,
        outputPrice: 15,
        cacheReadPrice: 0.3,
        cacheWritePrice: null,
        releaseDate: "2026-03-01",
      },
      {
        upstreamModelId: "example-small",
        name: "Example Small",
        kind: "chat",
        inputPrice: null,
        maxOutputTokens: null,
        ...UNIT_PRICES_AND_LIMITS,
        releaseDate: "2025-09-15",
      },
    ]);
  });

  it("keeps an operator's edits and creates nothing new when run again", async () => {
    await db
      .update(schema.providers)
      .set({
        endpoints: [
          { kind: "chat", protocol: "openai-chat", baseUrl: "https://proxy.internal/v1" },
        ],
        isEnabled: false,
      })
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
    expect(provider).toMatchObject({
      endpoints: [{ kind: "chat", protocol: "openai-chat", baseUrl: "https://proxy.internal/v1" }],
      isEnabled: false,
    });
    expect(provider?.upstreamModels).toHaveLength(2);
    expect(provider?.upstreamModels).toContainEqual(
      expect.objectContaining({ upstreamModelId: "example-large", inputPrice: 2.5 }),
    );
  });

  it("fills a missing Release Date and keeps the operator's other edits", async () => {
    await db
      .update(schema.upstreamModels)
      .set({ releaseDate: null, outputPrice: 14 })
      .where(eq(schema.upstreamModels.upstreamModelId, "example-large"));

    await commandBus.execute(new SeedCatalogCommand(catalog));

    const [model] = await db
      .select()
      .from(schema.upstreamModels)
      .where(eq(schema.upstreamModels.upstreamModelId, "example-large"));
    expect(model).toMatchObject({ releaseDate: "2026-03-01", outputPrice: 14 });
  });

  it("fills missing prices and max output and keeps the ones already set", async () => {
    await db
      .update(schema.upstreamModels)
      .set({ inputPrice: null, cacheReadPrice: null, maxOutputTokens: null, outputPrice: 13 })
      .where(eq(schema.upstreamModels.upstreamModelId, "example-large"));

    await commandBus.execute(new SeedCatalogCommand(catalog));

    const [model] = await db
      .select()
      .from(schema.upstreamModels)
      .where(eq(schema.upstreamModels.upstreamModelId, "example-large"));
    expect(model).toMatchObject({
      maxOutputTokens: 8192,
      inputPrice: 3,
      outputPrice: 13,
      cacheReadPrice: 0.3,
      cacheWritePrice: null,
    });
  });

  it("fills missing unit prices and media limits and keeps the ones already set", async () => {
    await db
      .update(schema.upstreamModels)
      .set({
        pricePerImage: null,
        pricePerImageBySize: null,
        pricePerInputImage: null,
        pricePerSecondByResolution: null,
        pricePerMillionCharacters: null,
        pricePerAudioSecond: null,
        maxInputImages: null,
        minDurationSeconds: null,
        maxDurationSeconds: null,
        resolutions: null,
        sizes: ["512*512"],
      })
      .where(eq(schema.upstreamModels.upstreamModelId, "example-small"));

    await commandBus.execute(new SeedCatalogCommand(catalog));

    const [model] = await db
      .select()
      .from(schema.upstreamModels)
      .where(eq(schema.upstreamModels.upstreamModelId, "example-small"));
    expect(model).toMatchObject({ ...UNIT_PRICES_AND_LIMITS, sizes: ["512*512"] });
  });

  it("keeps a Release Date the operator changed", async () => {
    await db
      .update(schema.upstreamModels)
      .set({ releaseDate: "2025-10-01" })
      .where(eq(schema.upstreamModels.upstreamModelId, "example-small"));

    await commandBus.execute(new SeedCatalogCommand(catalog));

    const [model] = await db
      .select()
      .from(schema.upstreamModels)
      .where(eq(schema.upstreamModels.upstreamModelId, "example-small"));
    expect(model?.releaseDate).toBe("2025-10-01");
  });

  it("fills a missing name and keeps one the operator set", async () => {
    await db
      .update(schema.upstreamModels)
      .set({ name: null })
      .where(eq(schema.upstreamModels.upstreamModelId, "example-large"));
    await db
      .update(schema.upstreamModels)
      .set({ name: "Small (operator)" })
      .where(eq(schema.upstreamModels.upstreamModelId, "example-small"));

    await commandBus.execute(new SeedCatalogCommand(catalog));

    const models = await db.select().from(schema.upstreamModels);
    expect(models).toContainEqual(
      expect.objectContaining({ upstreamModelId: "example-large", name: "Example Large" }),
    );
    expect(models).toContainEqual(
      expect.objectContaining({ upstreamModelId: "example-small", name: "Small (operator)" }),
    );
  });

  it("fills a missing logo", async () => {
    await db
      .update(schema.providers)
      .set({ logo: null })
      .where(eq(schema.providers.slug, "example"));

    await commandBus.execute(new SeedCatalogCommand(catalog));

    const provider = await db.query.providers.findFirst({ where: { slug: "example" } });
    expect(provider?.logo).toBe("example");
  });

  it("keeps an endpoint the operator deleted, and skips the Upstream Models of its Kind", async () => {
    const chatOnly = catalog[0].endpoints;
    await db
      .update(schema.providers)
      .set({ endpoints: chatOnly })
      .where(eq(schema.providers.slug, "example"));
    const catalogImage = {
      kind: "image" as const,
      protocol: "dashscope-image" as const,
      baseUrl: "https://api.example.com/api/v1",
    };
    const imageModel = {
      upstreamModelId: "example-image",
      name: "Example Image",
      kind: "image" as const,
      capabilities: [],
      contextSize: null,
      maxOutputTokens: null,
      inputPrice: null,
      outputPrice: null,
      cacheReadPrice: null,
      cacheWritePrice: null,
      pricePerImage: 0.03,
      releaseDate: "2026-01-01",
      source,
    };

    await commandBus.execute(
      new SeedCatalogCommand([
        {
          ...catalog[0],
          endpoints: [...chatOnly, catalogImage],
          upstreamModels: [...catalog[0].upstreamModels, imageModel],
        },
      ]),
    );

    const provider = await db.query.providers.findFirst({ where: { slug: "example" } });
    expect(provider?.endpoints).toEqual(chatOnly);
    const imageModels = await db
      .select()
      .from(schema.upstreamModels)
      .where(eq(schema.upstreamModels.upstreamModelId, "example-image"));
    expect(imageModels).toEqual([]);
  });

  describe("with an Upstream Model that lists Protocols", () => {
    const listedCatalog: CatalogProvider[] = [
      {
        ...catalog[0],
        slug: "listed",
        name: "Listed",
        endpoints: [
          { kind: "chat", protocol: "openai-chat", baseUrl: "https://api.listed.example/v1" },
          { kind: "chat", protocol: "anthropic-messages", baseUrl: "https://api.listed.example" },
        ],
        upstreamModels: [
          { ...catalog[0].upstreamModels[0], protocols: ["anthropic-messages", "openai-chat"] },
        ],
      },
    ];

    async function listedProtocols(): Promise<string[] | undefined> {
      const provider = await db.query.providers.findFirst({
        where: { slug: "listed" },
        with: { upstreamModels: true },
      });
      return provider?.upstreamModels[0]?.protocols;
    }

    it("creates the Upstream Model with the Protocols in the Catalog's order", async () => {
      await commandBus.execute(new SeedCatalogCommand(listedCatalog));

      expect(await listedProtocols()).toEqual(["anthropic-messages", "openai-chat"]);
    });

    it("keeps an emptied list when run again", async () => {
      await db.update(schema.upstreamModels).set({ protocols: [] });

      await commandBus.execute(new SeedCatalogCommand(listedCatalog));

      expect(await listedProtocols()).toEqual([]);
    });
  });

  it("keeps a logo the operator chose", async () => {
    await db
      .update(schema.providers)
      .set({ logo: "acme" })
      .where(eq(schema.providers.slug, "example"));

    await commandBus.execute(new SeedCatalogCommand(catalog));

    const provider = await db.query.providers.findFirst({ where: { slug: "example" } });
    expect(provider?.logo).toBe("acme");
  });

  it("creates no Provider Accounts, Models or Routes", async () => {
    const [accounts] = await db.select({ total: count() }).from(schema.providerAccounts);
    const [models] = await db.select({ total: count() }).from(schema.models);
    const [routes] = await db.select({ total: count() }).from(schema.routes);

    expect([accounts?.total, models?.total, routes?.total]).toEqual([0, 0, 0]);
  });

  describe("Pricing Windows", () => {
    async function windowPricesOf(upstreamModelId: string) {
      return db
        .select({
          window: schema.pricingWindows.name,
          inputPrice: schema.upstreamModelPricingWindows.inputPrice,
          outputPrice: schema.upstreamModelPricingWindows.outputPrice,
          cacheReadPrice: schema.upstreamModelPricingWindows.cacheReadPrice,
          cacheWritePrice: schema.upstreamModelPricingWindows.cacheWritePrice,
        })
        .from(schema.upstreamModelPricingWindows)
        .innerJoin(
          schema.pricingWindows,
          eq(schema.pricingWindows.id, schema.upstreamModelPricingWindows.pricingWindowId),
        )
        .innerJoin(
          schema.upstreamModels,
          eq(schema.upstreamModels.id, schema.upstreamModelPricingWindows.upstreamModelId),
        )
        .where(eq(schema.upstreamModels.upstreamModelId, upstreamModelId))
        .orderBy(asc(schema.pricingWindows.name));
    }

    async function storedWindow(name: string) {
      const [window] = await db
        .select()
        .from(schema.pricingWindows)
        .where(eq(schema.pricingWindows.name, name));
      return window;
    }

    it("creates the Catalog's Pricing Windows, enabled, and attaches the new models' Window Prices", async () => {
      const result = await commandBus.execute(new SeedCatalogCommand(windowedCatalog));

      expect(result).toMatchObject({ createdPricingWindows: 1, attachedWindowPrices: 2 });
      expect(await storedWindow(NIGHT.name)).toMatchObject({ ...NIGHT, isEnabled: true });
      expect(await windowPricesOf("windowed-large")).toEqual([
        {
          window: NIGHT.name,
          inputPrice: 1,
          outputPrice: 4,
          cacheReadPrice: null,
          cacheWritePrice: null,
        },
      ]);
    });

    it("creates and attaches nothing when run again", async () => {
      const result = await commandBus.execute(new SeedCatalogCommand(windowedCatalog));

      expect(result).toMatchObject({ createdPricingWindows: 0, attachedWindowPrices: 0 });
      const [attachments] = await db
        .select({ total: count() })
        .from(schema.upstreamModelPricingWindows);
      expect(attachments?.total).toBe(2);
    });

    it("leaves a disabled, edited window and a detached one alone", async () => {
      const editedRanges: PricingWindowRange[] = [{ weekdays: [1], start: "23:00", end: "24:00" }];
      await db
        .update(schema.pricingWindows)
        .set({ isEnabled: false, ranges: editedRanges })
        .where(eq(schema.pricingWindows.name, NIGHT.name));
      const [small] = await db
        .select({ id: schema.upstreamModels.id })
        .from(schema.upstreamModels)
        .where(eq(schema.upstreamModels.upstreamModelId, "windowed-small"));
      await db
        .delete(schema.upstreamModelPricingWindows)
        .where(eq(schema.upstreamModelPricingWindows.upstreamModelId, small?.id ?? ""));

      await commandBus.execute(new SeedCatalogCommand(windowedCatalog));

      expect(await storedWindow(NIGHT.name)).toMatchObject({
        isEnabled: false,
        ranges: editedRanges,
      });
      expect(await windowPricesOf("windowed-small")).toEqual([]);
    });

    it("attaches a window a later Catalog adds to the models", async () => {
      await commandBus.execute(new SeedCatalogCommand(windowedCatalogWithLunch));

      expect(await windowPricesOf("windowed-large")).toMatchObject([
        { window: LUNCH.name, cacheReadPrice: 0.1, inputPrice: null },
        { window: NIGHT.name, inputPrice: 1 },
      ]);
      expect(await windowPricesOf("windowed-small")).toMatchObject([
        { window: LUNCH.name, inputPrice: 0.25 },
      ]);
    });

    it("brings back a deleted window, attached to the models that list it", async () => {
      await db.delete(schema.pricingWindows).where(eq(schema.pricingWindows.name, NIGHT.name));

      await commandBus.execute(new SeedCatalogCommand(windowedCatalogWithLunch));

      expect(await storedWindow(NIGHT.name)).toMatchObject({ ...NIGHT, isEnabled: true });
      const large = await windowPricesOf("windowed-large");
      expect(large.map(({ window }) => window)).toEqual([LUNCH.name, NIGHT.name]);
      const small = await windowPricesOf("windowed-small");
      expect(small.map(({ window }) => window)).toEqual([LUNCH.name, NIGHT.name]);
    });

    it("skips and logs a Catalog window that would overlap an operator's attachment, keeping the operator's", async () => {
      const [large] = await db
        .select({ id: schema.upstreamModels.id })
        .from(schema.upstreamModels)
        .where(eq(schema.upstreamModels.upstreamModelId, "windowed-large"));
      const [sale] = await db
        .insert(schema.pricingWindows)
        .values({
          name: "Operator Sale",
          timeZone: "UTC",
          ranges: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "24:00" }],
        })
        .returning({ id: schema.pricingWindows.id });
      await db
        .delete(schema.upstreamModelPricingWindows)
        .where(eq(schema.upstreamModelPricingWindows.upstreamModelId, large?.id ?? ""));
      await db.insert(schema.upstreamModelPricingWindows).values({
        upstreamModelId: large?.id ?? "",
        pricingWindowId: sale?.id ?? "",
        inputPrice: 1,
      });
      const evening: CatalogPricingWindow = {
        name: "Example Evening",
        timeZone: "UTC",
        ranges: [{ weekdays: [1, 2, 3, 4, 5], start: "18:00", end: "20:00" }],
      };
      const loggedWarnings = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});

      const result = await commandBus.execute(
        new SeedCatalogCommand([
          {
            ...windowedCatalog[0],
            pricingWindows: [evening],
            upstreamModels: [
              windowedModel("windowed-large", [{ pricingWindow: evening.name, inputPrice: 0.5 }]),
            ],
          },
        ]),
      );

      expect(result).toMatchObject({ attachedWindowPrices: 0, skippedWindowPrices: 1 });
      expect(loggedWarnings).toHaveBeenCalledWith(
        expect.stringContaining('"Example Evening" on Upstream Model "windowed-large"'),
      );
      expect(await windowPricesOf("windowed-large")).toEqual([
        {
          window: "Operator Sale",
          inputPrice: 1,
          outputPrice: null,
          cacheReadPrice: null,
          cacheWritePrice: null,
        },
      ]);
    });
  });
});
