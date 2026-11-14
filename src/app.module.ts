import { Module, StandardSchemaValidationPipe } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { APP_PIPE } from "@nestjs/core";
import { ApiKeysModule } from "./api-keys/api-keys.module.js";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { type Env, envSchema } from "./config/env.schema.js";
import { relations } from "./db/relations.js";
import { QueueModule } from "./queue/queue.module.js";
import { UpstreamModule } from "./upstream/upstream.module.js";

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
    AuthModule,
    QueueModule,
    ApiKeysModule,
    UpstreamModule,
  ],
  controllers: [AppController],
  // Validates every `@Body({ schema })`, `@Param({ schema })`… against its zod schema.
  providers: [{ provide: APP_PIPE, useClass: StandardSchemaValidationPipe }],
})
export class AppModule {}
