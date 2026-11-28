import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HttpClientModule } from '@nestjs/http-client';
import { OutboundFetch } from '@/libs/providers/outbound-fetch';
import { RedisModule } from '@/redis/redis.module';
import { SnapshotModule } from '@/snapshot/snapshot.module';
import { SpendLimitsModule } from '@/spend-limits/spend-limits.module';
import { UpstreamModule } from '@/upstream/upstream.module';
import { UsageModule } from '@/usage/usage.module';
import { ApiKeyHeaderMiddleware } from './middleware/api-key-header.middleware';
import { CommandHandlers } from './commands/handlers';
import { InferenceExceptionFilter } from './filters/inference-exception.filter';
import { INFERENCE_API_PREFIX, InferenceController } from './inference.controller';
import { QueryHandlers } from './queries/handlers';
import { AttemptRunner } from './providers/attempt-runner';
import { CallerLimits } from './providers/caller-limits';
import { ConcurrencySlots } from './providers/concurrency-slots';
import { MediaFetcher } from './providers/media-fetcher';
import { MediaUpstreamClient } from './providers/media-upstream-client';
import { UpstreamClient } from './providers/upstream-client';
import { VideoHandles } from './providers/video-handles';
import { VideoTaskReader } from './providers/video-task-reader';

@Module({
  imports: [
    HttpClientModule.registerAsync({
      inject: [OutboundFetch],
      useFactory: (outbound: OutboundFetch) => ({ retry: false, fetch: outbound.fetch }),
    }),
    RedisModule,
    SnapshotModule,
    SpendLimitsModule,
    UpstreamModule,
    UsageModule,
  ],
  providers: [
    ...CommandHandlers,
    ...QueryHandlers,
    UpstreamClient,
    AttemptRunner,
    CallerLimits,
    ConcurrencySlots,
    MediaFetcher,
    MediaUpstreamClient,
    VideoHandles,
    VideoTaskReader,
    { provide: APP_FILTER, useClass: InferenceExceptionFilter },
  ],
})
export class InferenceModule implements NestModule {
  static overHttp(): DynamicModule {
    return { module: InferenceModule, controllers: [InferenceController] };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ApiKeyHeaderMiddleware).forRoutes(`${INFERENCE_API_PREFIX}/*path`);
  }
}
