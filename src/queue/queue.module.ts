import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@/config/schemas/env.schema';
import { PingProducer } from './jobs/ping.producer';
import { QUEUE_NAMES } from './models/queue-names';

const PRODUCER_RECONNECT_DELAY_MS = 1000;

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: {
          url: config.get('REDIS_URL', { infer: true }),
          maxRetriesPerRequest: 1,
          retryStrategy: () => PRODUCER_RECONNECT_DELAY_MS,
        },
        skipWaitingForReady: true,
      }),
    }),
    BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name }))),
  ],
  providers: [PingProducer],
  exports: [BullModule, PingProducer],
})
export class QueueModule {}
