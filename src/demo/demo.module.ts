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

const demoEnvSchema = envSchema.pick({ DATABASE_URL: true, ENCRYPTION_KEY: true });

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
    { provide: PasswordHasher, useValue: new PasswordHasher() },
    providerKeyCipherProvider,
    DemoApiKeyGenerator,
    ...CommandHandlers,
  ],
})
export class DemoModule {}
