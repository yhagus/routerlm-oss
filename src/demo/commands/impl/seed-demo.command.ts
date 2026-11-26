import { Command } from "@nestjs/cqrs";
import type { CatalogProvider } from "@/catalog/schemas/catalog.schema";

export type SeedDemoResult = { usageLogCount: number; errorCaptureCount: number };

export class SeedDemoCommand extends Command<SeedDemoResult> {
  constructor(
    readonly catalog: CatalogProvider[],
    readonly now: Date,
  ) {
    super();
  }
}
