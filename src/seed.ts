import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CommandBus } from "@nestjs/cqrs";
import { CatalogSeedModule } from "./catalog/catalog-seed.module.js";
import { SeedCatalogCommand } from "./catalog/commands/impl/seed-catalog.command.js";
import { CATALOG_DIRECTORY, loadCatalog } from "./catalog/models/load-catalog.js";

// `bun run db:seed`: loads the Catalog files and creates the Providers and
// Upstream Models the database is missing. Safe to run any number of times.

const catalog = await loadCatalog(CATALOG_DIRECTORY);
const app = await NestFactory.createApplicationContext(CatalogSeedModule, {
  logger: ["error", "warn", "log"],
});
try {
  const result = await app.get(CommandBus).execute(new SeedCatalogCommand(catalog));
  new Logger("Catalog").log(
    `Created ${result.createdProviders} Providers and ${result.createdUpstreamModels} Upstream Models`,
  );
} finally {
  await app.close();
}
