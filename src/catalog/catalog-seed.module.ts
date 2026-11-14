import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { type Env, envSchema } from "../config/env.schema.js";
import { relations } from "../db/relations.js";
import { CatalogSeeder } from "./catalog-seeder.js";

// Seeding needs only the database, so it doesn't demand REDIS_URL and the
// other variables the API process validates.
const seedEnvSchema = envSchema.pick({ DATABASE_URL: true });

/** What `db:seed` boots: config and the database, without the HTTP app. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: seedEnvSchema }),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Pick<Env, "DATABASE_URL">, true>) => ({
        drizzle,
        connection: config.get("DATABASE_URL", { infer: true }),
        relations,
      }),
    }),
  ],
  providers: [CatalogSeeder],
})
export class CatalogSeedModule {}
