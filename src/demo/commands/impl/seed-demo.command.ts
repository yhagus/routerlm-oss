import { Command } from "@nestjs/cqrs";
import type { CatalogProvider } from "@/catalog/schemas/catalog.schema.js";

export type SeedDemoResult = { usageLogCount: number; errorCaptureCount: number };

/**
 * Empties the demo database and fills it with a fictional install: the
 * Catalog, a User, Provider Accounts, Models, API Keys, Quota Meters and a
 * week of traffic, for the README screenshots.
 */
export class SeedDemoCommand extends Command<SeedDemoResult> {
  constructor(
    readonly catalog: CatalogProvider[],
    readonly now: Date,
  ) {
    super();
  }
}
