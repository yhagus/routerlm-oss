import { Logger } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { type AnyColumn, and, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import type { Database, Transaction } from "@/db/schemas/relations.js";
import {
  pricingWindows,
  type ProviderEndpoint,
  providers,
  upstreamModelPricingWindows,
  upstreamModels,
  type UpstreamProtocol,
} from "@/db/schemas/index.js";
import {
  SeedCatalogCommand,
  type SeedResult,
} from "@/catalog/commands/impl/seed-catalog.command.js";
import {
  type CatalogPricingWindow,
  type CatalogUpstreamModel,
  type CatalogWindowPrices,
} from "@/catalog/schemas/catalog.schema.js";
import { protocolsWithoutEndpoint } from "@/libs/models/provider-protocols.js";
import { selectAttachedPricingWindows } from "@/pricing-windows/models/upstream-model-pricing-windows.js";
import {
  doWindowPricesOverlap,
  type WindowPricesTiming,
} from "@/pricing-windows/models/window-prices-overlap.js";

type NamedWindowPricesTiming = WindowPricesTiming & { name: string };

function fillPrice(column: AnyColumn, catalogPrice: number | null): SQL {
  return sql`coalesce(${column}, ${catalogPrice}::numeric)`;
}

function protocolsServedBy(
  storedEndpoints: readonly ProviderEndpoint[],
  model: CatalogUpstreamModel,
): UpstreamProtocol[] {
  const unserved = protocolsWithoutEndpoint(model, storedEndpoints);
  return (model.protocols ?? []).filter((protocol) => !unserved.includes(protocol));
}

function fillEmpty(
  column: AnyColumn,
  catalogValue: unknown,
  sqlType: "integer" | "jsonb" | "text[]",
): SQL {
  const value =
    sqlType === "jsonb" && catalogValue != null ? JSON.stringify(catalogValue) : catalogValue;
  return sql`coalesce(${column}, ${sql.param(value ?? null)}::${sql.raw(sqlType)})`;
}

const FILLED_WHEN_EMPTY: AnyColumn[] = [
  upstreamModels.name,
  upstreamModels.releaseDate,
  upstreamModels.maxOutputTokens,
  upstreamModels.inputPrice,
  upstreamModels.outputPrice,
  upstreamModels.cacheReadPrice,
  upstreamModels.cacheWritePrice,
  upstreamModels.pricePerImage,
  upstreamModels.pricePerImageBySize,
  upstreamModels.pricePerInputImage,
  upstreamModels.pricePerSecondByResolution,
  upstreamModels.pricePerMillionCharacters,
  upstreamModels.pricePerAudioSecond,
  upstreamModels.maxInputImages,
  upstreamModels.minDurationSeconds,
  upstreamModels.maxDurationSeconds,
  upstreamModels.resolutions,
  upstreamModels.sizes,
];

@CommandHandler(SeedCatalogCommand)
export class SeedCatalogHandler implements ICommandHandler<SeedCatalogCommand> {
  private readonly logger = new Logger(SeedCatalogHandler.name);

  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ catalog }: SeedCatalogCommand): Promise<SeedResult> {
    const result: SeedResult = {
      createdProviders: 0,
      createdUpstreamModels: 0,
      createdPricingWindows: 0,
      attachedWindowPrices: 0,
      skippedWindowPrices: 0,
    };

    await this.db.transaction(async (tx) => {
      for (const entry of catalog) {
        const created = await tx
          .insert(providers)
          .values({
            slug: entry.slug,
            name: entry.name,
            logo: entry.logo ?? null,
            termsRisk: entry.termsRisk ?? false,
            endpoints: entry.endpoints,
            authStyle: entry.authStyle,
            quirks: entry.quirks,
            serviceTierValues: entry.serviceTierValues ?? {},
            quotaReader: entry.quotaReader ?? null,
            oauthLogin: entry.oauthLogin ?? null,
            credentialKinds: entry.credentialKinds,
            isFromCatalog: true,
          })
          .onConflictDoNothing({ target: providers.slug })
          .returning({ id: providers.id });
        result.createdProviders += created.length;

        const [provider] = await tx
          .select({ id: providers.id, endpoints: providers.endpoints })
          .from(providers)
          .where(eq(providers.slug, entry.slug));
        if (provider === undefined) {
          throw new Error(`Provider "${entry.slug}" vanished while seeding`);
        }
        if (entry.logo !== undefined) {
          await tx
            .update(providers)
            .set({ logo: entry.logo })
            .where(and(eq(providers.id, provider.id), isNull(providers.logo)));
        }
        const createdWindowNames = await this.createMissingPricingWindows(
          tx,
          entry.pricingWindows ?? [],
        );
        result.createdPricingWindows += createdWindowNames.size;
        const servedKinds = new Set(provider.endpoints.map((endpoint) => endpoint.kind));
        const servableModels = entry.upstreamModels.filter((model) =>
          servedKinds.has(model.kind ?? "chat"),
        );
        if (servableModels.length === 0) continue;

        const createdModels = await tx
          .insert(upstreamModels)
          .values(
            servableModels.map((model) => ({
              providerId: provider.id,
              upstreamModelId: model.upstreamModelId,
              name: model.name,
              capabilities: model.capabilities,
              contextSize: model.contextSize,
              maxOutputTokens: model.maxOutputTokens,
              inputPrice: model.inputPrice,
              outputPrice: model.outputPrice,
              cacheReadPrice: model.cacheReadPrice,
              cacheWritePrice: model.cacheWritePrice,
              kind: model.kind ?? "chat",
              protocols: protocolsServedBy(provider.endpoints, model),
              pricePerImage: model.pricePerImage ?? null,
              pricePerImageBySize: model.pricePerImageBySize ?? null,
              pricePerInputImage: model.pricePerInputImage ?? null,
              pricePerSecondByResolution: model.pricePerSecondByResolution ?? null,
              pricePerMillionCharacters: model.pricePerMillionCharacters ?? null,
              pricePerAudioSecond: model.pricePerAudioSecond ?? null,
              maxInputImages: model.maxInputImages ?? null,
              minDurationSeconds: model.minDurationSeconds ?? null,
              maxDurationSeconds: model.maxDurationSeconds ?? null,
              resolutions: model.resolutions ?? null,
              sizes: model.sizes ?? null,
              serviceTiers: model.serviceTiers ?? [],
              tierPrices: model.tierPrices ?? {},
              releaseDate: model.releaseDate,
            })),
          )
          .onConflictDoNothing({
            target: [upstreamModels.providerId, upstreamModels.upstreamModelId],
          })
          .returning({ upstreamModelId: upstreamModels.upstreamModelId });
        result.createdUpstreamModels += createdModels.length;

        for (const model of servableModels) {
          await tx
            .update(upstreamModels)
            .set({
              name: sql`coalesce(${upstreamModels.name}, ${model.name}::text)`,
              releaseDate: sql`coalesce(${upstreamModels.releaseDate}, ${model.releaseDate}::date)`,
              maxOutputTokens: sql`coalesce(${upstreamModels.maxOutputTokens}, ${model.maxOutputTokens}::integer)`,
              inputPrice: fillPrice(upstreamModels.inputPrice, model.inputPrice),
              outputPrice: fillPrice(upstreamModels.outputPrice, model.outputPrice),
              cacheReadPrice: fillPrice(upstreamModels.cacheReadPrice, model.cacheReadPrice),
              cacheWritePrice: fillPrice(upstreamModels.cacheWritePrice, model.cacheWritePrice),
              pricePerImage: fillPrice(upstreamModels.pricePerImage, model.pricePerImage ?? null),
              pricePerImageBySize: fillEmpty(
                upstreamModels.pricePerImageBySize,
                model.pricePerImageBySize,
                "jsonb",
              ),
              pricePerInputImage: fillPrice(
                upstreamModels.pricePerInputImage,
                model.pricePerInputImage ?? null,
              ),
              pricePerSecondByResolution: fillEmpty(
                upstreamModels.pricePerSecondByResolution,
                model.pricePerSecondByResolution,
                "jsonb",
              ),
              pricePerMillionCharacters: fillPrice(
                upstreamModels.pricePerMillionCharacters,
                model.pricePerMillionCharacters ?? null,
              ),
              pricePerAudioSecond: fillPrice(
                upstreamModels.pricePerAudioSecond,
                model.pricePerAudioSecond ?? null,
              ),
              maxInputImages: fillEmpty(
                upstreamModels.maxInputImages,
                model.maxInputImages,
                "integer",
              ),
              minDurationSeconds: fillEmpty(
                upstreamModels.minDurationSeconds,
                model.minDurationSeconds,
                "integer",
              ),
              maxDurationSeconds: fillEmpty(
                upstreamModels.maxDurationSeconds,
                model.maxDurationSeconds,
                "integer",
              ),
              resolutions: fillEmpty(upstreamModels.resolutions, model.resolutions, "text[]"),
              sizes: fillEmpty(upstreamModels.sizes, model.sizes, "text[]"),
            })
            .where(
              and(
                eq(upstreamModels.providerId, provider.id),
                eq(upstreamModels.upstreamModelId, model.upstreamModelId),
                or(...FILLED_WHEN_EMPTY.map((column) => isNull(column))),
              ),
            );
        }

        const createdModelIds = new Set(createdModels.map((model) => model.upstreamModelId));
        const { attached, skipped } = await this.attachNewWindowPrices(
          tx,
          provider.id,
          servableModels,
          (model, entry) =>
            createdModelIds.has(model.upstreamModelId) ||
            createdWindowNames.has(entry.pricingWindow),
        );
        result.attachedWindowPrices += attached;
        result.skippedWindowPrices += skipped;
      }
    });

    return result;
  }

  private async createMissingPricingWindows(
    tx: Transaction,
    windows: readonly CatalogPricingWindow[],
  ): Promise<Set<string>> {
    if (windows.length === 0) return new Set();

    const created = await tx
      .insert(pricingWindows)
      .values(
        windows.map((window) => ({
          name: window.name,
          timeZone: window.timeZone,
          ranges: window.ranges,
          isEnabled: true,
        })),
      )
      .onConflictDoNothing({ target: pricingWindows.name })
      .returning({ name: pricingWindows.name });
    return new Set(created.map((window) => window.name));
  }

  private async attachNewWindowPrices(
    tx: Transaction,
    providerId: string,
    models: readonly CatalogUpstreamModel[],
    isNew: (model: CatalogUpstreamModel, entry: CatalogWindowPrices) => boolean,
  ): Promise<{ attached: number; skipped: number }> {
    const attachments = models
      .map((model) => ({
        model,
        entries: (model.windowPrices ?? []).filter((entry) => isNew(model, entry)),
      }))
      .filter(({ entries }) => entries.length > 0);
    if (attachments.length === 0) return { attached: 0, skipped: 0 };

    const windowNames = attachments.flatMap(({ entries }) =>
      entries.map((entry) => entry.pricingWindow),
    );
    const storedWindows = await tx
      .select({
        id: pricingWindows.id,
        name: pricingWindows.name,
        timeZone: pricingWindows.timeZone,
        ranges: pricingWindows.ranges,
      })
      .from(pricingWindows)
      .where(inArray(pricingWindows.name, windowNames));
    const windowByName = new Map(storedWindows.map((window) => [window.name, window]));

    const storedModels = await tx
      .select({ id: upstreamModels.id, upstreamModelId: upstreamModels.upstreamModelId })
      .from(upstreamModels)
      .where(eq(upstreamModels.providerId, providerId));
    const modelIdByUpstreamId = new Map(
      storedModels.map((model) => [model.upstreamModelId, model.id]),
    );

    const now = new Date();
    let attached = 0;
    let skipped = 0;
    for (const { model, entries } of attachments) {
      const modelId = modelIdByUpstreamId.get(model.upstreamModelId);
      if (modelId === undefined) {
        throw new Error(`Upstream Model "${model.upstreamModelId}" vanished while seeding`);
      }
      const modelWindows: NamedWindowPricesTiming[] = await selectAttachedPricingWindows(
        tx,
        eq(upstreamModelPricingWindows.upstreamModelId, modelId),
      );

      const rows: Array<typeof upstreamModelPricingWindows.$inferInsert> = [];
      for (const entry of entries) {
        const storedWindow = windowByName.get(entry.pricingWindow);
        if (storedWindow === undefined) {
          throw new Error(`Pricing Window "${entry.pricingWindow}" vanished while seeding`);
        }
        const window: NamedWindowPricesTiming = {
          ...storedWindow,
          validFrom: null,
          validUntil: null,
        };
        const overlapping = modelWindows.find((other) => doWindowPricesOverlap(window, other, now));
        if (overlapping !== undefined) {
          this.logger.warn(
            `Skipped the Catalog's Window Prices for "${window.name}" on Upstream Model "${model.upstreamModelId}": they would overlap those for "${overlapping.name}" (ADR 0040)`,
          );
          skipped += 1;
          continue;
        }
        modelWindows.push(window);
        rows.push({
          upstreamModelId: modelId,
          pricingWindowId: storedWindow.id,
          inputPrice: entry.inputPrice ?? null,
          outputPrice: entry.outputPrice ?? null,
          cacheReadPrice: entry.cacheReadPrice ?? null,
          cacheWritePrice: entry.cacheWritePrice ?? null,
        });
      }
      if (rows.length > 0) {
        await tx.insert(upstreamModelPricingWindows).values(rows);
        attached += rows.length;
      }
    }
    return { attached, skipped };
  }
}
