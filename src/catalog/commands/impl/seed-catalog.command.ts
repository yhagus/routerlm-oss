import { Command } from '@nestjs/cqrs';
import type { CatalogProvider } from '@/catalog/schemas/catalog.schema';

export type SeedResult = {
  createdProviders: number;
  createdUpstreamModels: number;
  createdPricingWindows: number;
  attachedWindowPrices: number;
  skippedWindowPrices: number;
};

export class SeedCatalogCommand extends Command<SeedResult> {
  constructor(readonly catalog: CatalogProvider[]) {
    super();
  }
}
