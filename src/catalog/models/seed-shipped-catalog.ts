import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CommandBus } from "@nestjs/cqrs";
import { CatalogSeedModule } from "@/catalog/catalog-seed.module.js";
import { SeedCatalogCommand } from "@/catalog/commands/impl/seed-catalog.command.js";
import { CATALOG_DIRECTORY, loadCatalog } from "./load-catalog.js";

/**
 * Loads the Catalog files shipped with the gateway and creates the Providers
 * and Upstream Models the database at DATABASE_URL is missing. Safe to run
 * any number of times.
 */
export async function seedShippedCatalog(): Promise<void> {
  const catalog = await loadCatalog(CATALOG_DIRECTORY);
  const app = await NestFactory.createApplicationContext(CatalogSeedModule, {
    logger: ["error", "warn", "log"],
  });
  try {
    const result = await app.get(CommandBus).execute(new SeedCatalogCommand(catalog));
    new Logger("Catalog").log(
      `Created ${result.createdProviders} Providers, ${result.createdUpstreamModels} Upstream Models and ${result.createdPricingWindows} Pricing Windows, and attached ${result.attachedWindowPrices} Window Prices`,
    );
  } finally {
    await app.close();
  }
}
