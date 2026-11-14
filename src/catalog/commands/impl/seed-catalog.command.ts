import { Command } from "@nestjs/cqrs";
import type { CatalogProvider } from "../../schemas/catalog.schema.js";

export type SeedResult = { createdProviders: number; createdUpstreamModels: number };

/**
 * Creates the Catalog's Providers and Upstream Models that are missing from
 * the database. Rows that already exist are never changed, so an operator's
 * edits survive (ADR 0003).
 */
export class SeedCatalogCommand extends Command<SeedResult> {
  constructor(readonly catalog: CatalogProvider[]) {
    super();
  }
}
