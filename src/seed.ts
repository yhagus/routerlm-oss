import "reflect-metadata";
import { seedShippedCatalog } from "@/catalog/models/seed-shipped-catalog.js";

// `bun run db:seed`: loads the Catalog files and creates the Providers and
// Upstream Models the database is missing. Safe to run any number of times.

await seedShippedCatalog();
