import "reflect-metadata";
import { fileURLToPath } from "node:url";
import { Logger } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { seedShippedCatalog } from "@/catalog/models/seed-shipped-catalog";
import { envSchema } from "@/config/schemas/env.schema";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

const { DATABASE_URL } = envSchema.pick({ DATABASE_URL: true }).parse(process.env);
const pool = new Pool({ connectionString: DATABASE_URL });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
  new Logger("Migrate").log("Database migrations are up to date");
} finally {
  await pool.end();
}

await seedShippedCatalog();
