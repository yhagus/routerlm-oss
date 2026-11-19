import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { HttpClientModule } from "@nestjs/http-client";
import { OutboundFetch } from "@/libs/providers/outbound-fetch.js";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { UpstreamModule } from "@/upstream/upstream.module.js";
import { UsageModule } from "@/usage/usage.module.js";
import { ApiKeyHeaderMiddleware } from "./middleware/api-key-header.middleware.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { InferenceExceptionFilter } from "./filters/inference-exception.filter.js";
import { INFERENCE_API_PREFIX, InferenceController } from "./inference.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";
import { AttemptRunner } from "./providers/attempt-runner.js";
import { MediaFetcher } from "./providers/media-fetcher.js";
import { MediaUpstreamClient } from "./providers/media-upstream-client.js";
import { UpstreamClient } from "./providers/upstream-client.js";
import { VideoHandles } from "./providers/video-handles.js";
import { VideoTaskReader } from "./providers/video-task-reader.js";

/** The client-facing `/v1/*` API: inference and the Model list. */
@Module({
  // Retries are off: Fallback across Provider Accounts and Routes is the gateway's job.
  imports: [
    HttpClientModule.registerAsync({
      inject: [OutboundFetch],
      useFactory: (outbound: OutboundFetch) => ({ retry: false, fetch: outbound.fetch }),
    }),
    SnapshotModule,
    UpstreamModule,
    UsageModule,
  ],
  controllers: [InferenceController],
  providers: [
    ...CommandHandlers,
    ...QueryHandlers,
    UpstreamClient,
    AttemptRunner,
    MediaFetcher,
    MediaUpstreamClient,
    VideoHandles,
    VideoTaskReader,
    { provide: APP_FILTER, useClass: InferenceExceptionFilter },
  ],
})
export class InferenceModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ApiKeyHeaderMiddleware).forRoutes(`${INFERENCE_API_PREFIX}/*path`);
  }
}
