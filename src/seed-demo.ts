import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CommandBus } from "@nestjs/cqrs";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";
import { DEMO_USER } from "@/demo/data/demo-fixtures.js";
import { DemoModule } from "@/demo/demo.module.js";
import { SeedDemoCommand } from "@/demo/commands/impl/seed-demo.command.js";
import { assertDemoDatabase } from "@/demo/models/demo-database.js";

assertDemoDatabase(process.env.DATABASE_URL);

const catalog = await loadCatalog(CATALOG_DIRECTORY);
const app = await NestFactory.createApplicationContext(DemoModule, {
  logger: ["error", "warn", "log"],
});
try {
  const result = await app.get(CommandBus).execute(new SeedDemoCommand(catalog, new Date()));
  const logger = new Logger("Demo");
  logger.log(
    `Seeded ${result.usageLogCount} Usage Logs and ${result.errorCaptureCount} Error Captures`,
  );
  logger.log(`Sign in as ${DEMO_USER.email} with password ${DEMO_USER.password}`);
} finally {
  await app.close();
}
