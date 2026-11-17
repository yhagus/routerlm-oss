import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpClientModule } from "@nestjs/http-client";
import type { Env } from "@/config/schemas/env.schema.js";
import { CatalogGapsController } from "./catalog-gaps.controller.js";
import { MODELS_DEV_HTTP_CLIENT } from "./providers/models-dev-http-client.js";
import { ModelsDevReader } from "./providers/models-dev-reader.js";
import { QueryHandlers } from "./queries/handlers/index.js";

/**
 * Catalog Gaps for the dashboard. Apart from CatalogModule, which the seed
 * commands boot without the HTTP app and its session auth.
 */
@Module({
  imports: [
    HttpClientModule.registerAsync({
      name: MODELS_DEV_HTTP_CLIENT,
      inject: [ConfigService],
      // No retries: the next request is the retry. A failed read costs at most the timeout.
      useFactory: (config: ConfigService<Env, true>) => ({
        timeout: config.get("MODELS_DEV_TIMEOUT_MS", { infer: true }),
        retry: false,
      }),
    }),
  ],
  controllers: [CatalogGapsController],
  providers: [ModelsDevReader, ...QueryHandlers],
})
export class CatalogGapsModule {}
