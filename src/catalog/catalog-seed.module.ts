import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { type Env, envSchema } from "../config/env.schema.js";
import { relations } from "../db/relations.js";
import { CatalogSeeder } from "./catalog-seeder.js";

/**
 * What `db:seed` boots: config and the database, without the HTTP app, so
 * seeding needs nothing the API process needs (Redis, encryption keys...).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        drizzle,
        connection: config.get("DATABASE_URL", { infer: true }),
        relations,
      }),
    }),
  ],
  providers: [CatalogSeeder],
})
export class CatalogSeedModule {}
