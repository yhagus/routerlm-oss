import { Command } from "@nestjs/cqrs";
import type { CatalogProvider } from "@/catalog/schemas/catalog.schema.js";

export type SeedResult = {
  createdProviders: number;
  createdUpstreamModels: number;
  createdPricingWindows: number;
  attachedWindowPrices: number;
  /** Catalog Window Prices left out because they would overlap a model's attachment (ADR 0040). */
  skippedWindowPrices: number;
};

/**
 * Creates the Catalog's Providers and Upstream Models that are missing from
 * the database. Rows that already exist are not changed, so an operator's
 * edits survive (ADR 0003). The exception is an empty Release Date, max output or price,
 * which is filled from the Catalog. A model's Catalog Window Prices are
 * attached only when the model or the Pricing Window is created in the same
 * run (ADR 0039), and never when they would overlap the model's attachments (ADR 0040).
 */
export class SeedCatalogCommand extends Command<SeedResult> {
  constructor(readonly catalog: CatalogProvider[]) {
    super();
  }
}
