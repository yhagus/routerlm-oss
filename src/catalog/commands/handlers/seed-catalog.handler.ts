import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { type AnyColumn, and, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providers, upstreamModels } from "@/db/schemas/index.js";
import { SeedCatalogCommand, type SeedResult } from "../impl/seed-catalog.command.js";

/** Keeps the stored price, or takes the Catalog's when the stored one is empty. */
function fillPrice(column: AnyColumn, catalogPrice: number | null): SQL {
  return sql`coalesce(${column}, ${catalogPrice}::numeric)`;
}

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
            protocol: entry.protocol,
            baseUrl: entry.baseUrl,
            authStyle: entry.authStyle,
            quirks: entry.quirks,
            quotaReader: entry.quotaReader ?? null,
            oauthLogin: entry.oauthLogin ?? null,
            credentialKinds: entry.credentialKinds,
            isFromCatalog: true,
          })
          .onConflictDoNothing({ target: providers.slug })
          .returning({ id: providers.id });
        result.createdProviders += created.length;

        const [provider] = await tx
          .select({ id: providers.id })
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
        if (entry.upstreamModels.length === 0) continue;

        const createdModels = await tx
          .insert(upstreamModels)
          .values(
            entry.upstreamModels.map((model) => ({
              providerId: provider.id,
              upstreamModelId: model.upstreamModelId,
              name: model.name ?? null,
              capabilities: model.capabilities,
              contextSize: model.contextSize,
              maxOutputTokens: model.maxOutputTokens,
              inputPrice: model.inputPrice,
              outputPrice: model.outputPrice,
              cacheReadPrice: model.cacheReadPrice,
              cacheWritePrice: model.cacheWritePrice,
              releaseDate: model.releaseDate,
            })),
          )
          .onConflictDoNothing({
            target: [upstreamModels.providerId, upstreamModels.upstreamModelId],
          })
          .returning({ id: upstreamModels.id });
        result.createdUpstreamModels += createdModels.length;

        // The one exception to never changing existing rows (ADR 0003): an
        // empty name, Release Date, max output or price gets the Catalog's value, so rows seeded
        // before the Catalog knew it catch up. A value that is already set,
        // Catalog or operator, is left alone.
        for (const model of entry.upstreamModels) {
          await tx
            .update(upstreamModels)
            .set({
              name: sql`coalesce(${upstreamModels.name}, ${model.name ?? null}::text)`,
              releaseDate: sql`coalesce(${upstreamModels.releaseDate}, ${model.releaseDate}::date)`,
              maxOutputTokens: sql`coalesce(${upstreamModels.maxOutputTokens}, ${model.maxOutputTokens}::integer)`,
              inputPrice: fillPrice(upstreamModels.inputPrice, model.inputPrice),
              outputPrice: fillPrice(upstreamModels.outputPrice, model.outputPrice),
              cacheReadPrice: fillPrice(upstreamModels.cacheReadPrice, model.cacheReadPrice),
              cacheWritePrice: fillPrice(upstreamModels.cacheWritePrice, model.cacheWritePrice),
            })
            .where(
              and(
                eq(upstreamModels.providerId, provider.id),
                eq(upstreamModels.upstreamModelId, model.upstreamModelId),
                or(
                  isNull(upstreamModels.name),
                  isNull(upstreamModels.releaseDate),
                  isNull(upstreamModels.maxOutputTokens),
                  isNull(upstreamModels.inputPrice),
                  isNull(upstreamModels.outputPrice),
                  isNull(upstreamModels.cacheReadPrice),
                  isNull(upstreamModels.cacheWritePrice),
                ),
              ),
            );
        }
      }
    });

    return result;
  }
}
