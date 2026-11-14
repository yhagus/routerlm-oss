import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "../db/relations.js";
import { providers, upstreamModels } from "../db/schema.js";
import type { CatalogProvider } from "./catalog.schema.js";

export type SeedResult = { createdProviders: number; createdUpstreamModels: number };

/**
 * Creates the Catalog's Providers and Upstream Models that are missing from
 * the database. Rows that already exist are never changed, so an operator's
 * edits survive (ADR 0003).
 */
@Injectable()
export class CatalogSeeder {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async seed(catalog: CatalogProvider[]): Promise<SeedResult> {
    const result: SeedResult = { createdProviders: 0, createdUpstreamModels: 0 };

    await this.db.transaction(async (tx) => {
      for (const entry of catalog) {
        const created = await tx
          .insert(providers)
          .values({
            slug: entry.slug,
            name: entry.name,
            protocol: entry.protocol,
            baseUrl: entry.baseUrl,
            authStyle: entry.authStyle,
            quirks: entry.quirks,
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
        if (entry.upstreamModels.length === 0) continue;

        const createdModels = await tx
          .insert(upstreamModels)
          .values(
            entry.upstreamModels.map((model) => ({
              providerId: provider.id,
              upstreamModelId: model.upstreamModelId,
              capabilities: model.capabilities,
              contextSize: model.contextSize,
              maxOutputTokens: model.maxOutputTokens,
              inputPrice: model.inputPrice,
              outputPrice: model.outputPrice,
              cacheReadPrice: model.cacheReadPrice,
              cacheWritePrice: model.cacheWritePrice,
            })),
          )
          .onConflictDoNothing({
            target: [upstreamModels.providerId, upstreamModels.upstreamModelId],
          })
          .returning({ id: upstreamModels.id });
        result.createdUpstreamModels += createdModels.length;
      }
    });

    return result;
  }
}
