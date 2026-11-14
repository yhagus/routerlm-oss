import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CatalogSeedModule } from "./catalog-seed.module.js";
import { CatalogSeeder } from "./catalog-seeder.js";
import { CATALOG_DIRECTORY, loadCatalog } from "./load-catalog.js";

// `bun run db:seed`: loads the Catalog files and creates the Providers and
// Upstream Models the database is missing. Safe to run any number of times.

const catalog = await loadCatalog(CATALOG_DIRECTORY);
const app = await NestFactory.createApplicationContext(CatalogSeedModule, {
  logger: ["error", "warn", "log"],
});
try {
  const result = await app.get(CatalogSeeder).seed(catalog);
  new Logger("Catalog").log(
    `Created ${result.createdProviders} Providers and ${result.createdUpstreamModels} Upstream Models`,
  );
} finally {
  await app.close();
}
