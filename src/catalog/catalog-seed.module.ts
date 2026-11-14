import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { type Env, envSchema } from "@/config/schemas/env.schema.js";
import { relations } from "@/db/schemas/relations.js";
import { LibsModule } from "@/libs/libs.module.js";
import { CommandHandlers } from "./commands/handlers/index.js";

// Seeding needs only the database, so it doesn't demand REDIS_URL and the
// other variables the API process validates.
const seedEnvSchema = envSchema.pick({ DATABASE_URL: true });

/** What `db:seed` boots: config, the database and the command bus, without the HTTP app. */
@Module({
  imports: [
    CqrsModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validationSchema: seedEnvSchema }),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Pick<Env, "DATABASE_URL">, true>) => ({
        drizzle,
        connection: config.get("DATABASE_URL", { infer: true }),
        relations,
      }),
    }),
    LibsModule,
  ],
  providers: [...CommandHandlers],
})
export class CatalogSeedModule {}
