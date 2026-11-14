import { Module, StandardSchemaValidationPipe } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { APP_PIPE } from "@nestjs/core";
import { ApiKeysModule } from "./api-keys/api-keys.module.js";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { type Env, envSchema } from "./config/schemas/env.schema.js";
import { relations } from "./db/schemas/relations.js";
import { ErrorCapturesModule } from "./error-captures/error-captures.module.js";
import { InferenceModule } from "./inference/inference.module.js";
import { OverviewModule } from "./overview/overview.module.js";
import { PlaygroundModule } from "./playground/playground.module.js";
import { QueueModule } from "./queue/queue.module.js";
import { RoutingModule } from "./routing/routing.module.js";
import { UpstreamModule } from "./upstream/upstream.module.js";
import { UsageModule } from "./usage/usage.module.js";

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
    CqrsModule.forRoot(),
    AuthModule,
    QueueModule,
    ApiKeysModule,
    UpstreamModule,
    RoutingModule,
    InferenceModule,
    UsageModule,
    ErrorCapturesModule,
    OverviewModule,
    PlaygroundModule,
  ],
  controllers: [AppController],
  // Validates every `@Body({ schema })`, `@Param({ schema })`… against its zod schema.
  providers: [{ provide: APP_PIPE, useClass: StandardSchemaValidationPipe }],
})
export class AppModule {}
