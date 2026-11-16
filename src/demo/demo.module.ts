import { PasswordHasher } from "@nestjs/authentication";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { CatalogModule } from "@/catalog/catalog.module.js";
import { type Env, envSchema } from "@/config/schemas/env.schema.js";
import { relations } from "@/db/schemas/relations.js";
import { LibsModule } from "@/libs/libs.module.js";
import { providerKeyCipherProvider } from "@/upstream/providers/provider-key-cipher.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { DemoApiKeyGenerator } from "./providers/demo-api-key-generator.js";

// The database, and the key that encrypts the demo Provider Account keys so
// the app started on the same .env can read them. No Redis: nothing here
// publishes to running instances.
const demoEnvSchema = envSchema.pick({ DATABASE_URL: true, ENCRYPTION_KEY: true });

/**
 * What `db:seed:demo` boots: config, the database and the command bus, with
 * the Catalog seeding it starts from.
 */
@Module({
  imports: [
    CqrsModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validationSchema: demoEnvSchema }),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Pick<Env, "DATABASE_URL">, true>) => ({
        drizzle,
        connection: config.get("DATABASE_URL", { infer: true }),
        relations,
      }),
    }),
    LibsModule,
    CatalogModule,
  ],
  providers: [
    // The production cost, as AuthenticationModule's default: the demo User signs in like any other.
    { provide: PasswordHasher, useValue: new PasswordHasher() },
    providerKeyCipherProvider,
    DemoApiKeyGenerator,
    ...CommandHandlers,
  ],
})
export class DemoModule {}
