import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq, inArray } from "drizzle-orm";
import { providers, upstreamModels } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import type { CatalogGap, CatalogGapReport } from "../../models/catalog-gap.js";
import { CATALOG_DIRECTORY, loadCatalog } from "../../models/load-catalog.js";
import { ModelsDevReader } from "../../providers/models-dev-reader.js";
import { ListCatalogGapsQuery } from "../impl/list-catalog-gaps.query.js";

/**
 * Compares models.dev with the Upstream Models in the database, not the
 * shipped files: an operator may have added or removed models since seeding.
 * The shipped files say which models.dev provider each Provider slug maps to.
 * A Provider missing from the database is skipped: it was removed on purpose.
 * Only the five newest models across those registered Providers are checked,
 * so a report never holds more than five gaps.
 */
const NEWEST_MODELS_CHECKED = 5;

@QueryHandler(ListCatalogGapsQuery)
export class ListCatalogGapsHandler implements IQueryHandler<ListCatalogGapsQuery> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly modelsDev: ModelsDevReader,
  ) {}

  async execute(): Promise<CatalogGapReport> {
    const snapshot = await this.modelsDev.readNewestModels();
    if (snapshot === null) return { checkedAt: null, gaps: [] };

    const shippedProviders = (await loadCatalog(CATALOG_DIRECTORY)).filter(
      (provider) => provider.modelsDevProviderId !== undefined,
    );
    const stored = await this.db
      .select({
        slug: providers.slug,
        name: providers.name,
        upstreamModelId: upstreamModels.upstreamModelId,
      })
      .from(providers)
      .leftJoin(upstreamModels, eq(upstreamModels.providerId, providers.id))
      .where(
        inArray(
          providers.slug,
          shippedProviders.map((provider) => provider.slug),
        ),
      );

    const newest: Array<CatalogGap & { held: boolean }> = [];
    for (const shipped of shippedProviders) {
      const rows = stored.filter((row) => row.slug === shipped.slug);
      const providerName = rows[0]?.name;
      if (providerName === undefined || shipped.modelsDevProviderId === undefined) continue;
      const heldModelIds = new Set(rows.map((row) => row.upstreamModelId));
      const newestModels = snapshot.newestModelsByProviderId.get(shipped.modelsDevProviderId) ?? [];
      for (const model of newestModels) {
        newest.push({
          held: heldModelIds.has(model.id),
          providerSlug: shipped.slug,
          providerName,
          upstreamModelId: model.id,
          name: model.name,
          releaseDate: model.releaseDate,
        });
      }
    }

    newest.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
    const gaps = newest
      .slice(0, NEWEST_MODELS_CHECKED)
      .filter(({ held }) => !held)
      .map(({ held: _held, ...gap }) => gap);
    return { checkedAt: snapshot.checkedAt, gaps };
  }
}
