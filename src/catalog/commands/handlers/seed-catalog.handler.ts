import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { type AnyColumn, and, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providers, upstreamModels } from "@/db/schemas/index.js";
import {
  SeedCatalogCommand,
  type SeedResult,
} from "@/catalog/commands/impl/seed-catalog.command.js";

/** Keeps the stored price, or takes the Catalog's when the stored one is empty. */
function fillPrice(column: AnyColumn, catalogPrice: number | null): SQL {
  return sql`coalesce(${column}, ${catalogPrice}::numeric)`;
}

/** As fillPrice, for a value of another SQL type; one parameter even for an array. */
function fillEmpty(
  column: AnyColumn,
  catalogValue: unknown,
  sqlType: "integer" | "jsonb" | "text[]",
): SQL {
  const value =
    sqlType === "jsonb" && catalogValue != null ? JSON.stringify(catalogValue) : catalogValue;
  return sql`coalesce(${column}, ${sql.param(value ?? null)}::${sql.raw(sqlType)})`;
}

/** The Upstream Model columns a seed fills when they are empty (ADR 0003). */
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
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ catalog }: SeedCatalogCommand): Promise<SeedResult> {
    const result: SeedResult = { createdProviders: 0, createdUpstreamModels: 0 };

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
        // The fill-empty exception below (ADR 0003) covers the Provider's logo too.
        if (entry.logo !== undefined) {
          await tx
            .update(providers)
            .set({ logo: entry.logo })
            .where(and(eq(providers.id, provider.id), isNull(providers.logo)));
        }
        // Endpoints are never added to an existing Provider: an operator may
        // have deleted one (ADR 0026). A model of a Kind with no endpoint
        // could not be served, so it is not seeded either.
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
          .returning({ id: upstreamModels.id });
        result.createdUpstreamModels += createdModels.length;

        // The one exception to never changing existing rows (ADR 0003): an
        // empty name, Release Date, max output, price or media limit gets the Catalog's value, so rows seeded
        // before the Catalog knew it catch up. A value that is already set,
        // Catalog or operator, is left alone.
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
      }
    });

    return result;
  }
}
