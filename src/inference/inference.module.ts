import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { HttpClientModule } from "@nestjs/http-client";
import { SnapshotModule } from "../snapshot/snapshot.module.js";
import { UpstreamModule } from "../upstream/upstream.module.js";
import { ApiKeyHeaderMiddleware } from "./api-key-header.middleware.js";
import { ClientModelsService } from "./client-models.service.js";
import { InferenceExceptionFilter } from "./inference-exception.filter.js";
import { INFERENCE_API_PREFIX, InferenceController } from "./inference.controller.js";
import { InferenceService } from "./inference.service.js";
import { UpstreamClient } from "./upstream-client.js";

/** The client-facing `/v1/*` API: inference and the Model list. */
@Module({
  // Retries are off: Fallback across Provider Accounts and Routes is the gateway's job.
  imports: [HttpClientModule.register({ retry: false }), SnapshotModule, UpstreamModule],
  controllers: [InferenceController],
  providers: [
    InferenceService,
    ClientModelsService,
    UpstreamClient,
    { provide: APP_FILTER, useClass: InferenceExceptionFilter },
  ],
})
export class InferenceModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ApiKeyHeaderMiddleware).forRoutes(`${INFERENCE_API_PREFIX}/*path`);
  }
}
