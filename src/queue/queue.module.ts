import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "@/config/schemas/env.schema.js";
import { PingProducer } from "./jobs/ping.producer.js";
import { QUEUE_NAMES } from "./models/queue-names.js";

const PRODUCER_RECONNECT_DELAY_MS = 1000;

/**
 * Producer side of the queues, for the HTTP backend. It holds no processors:
 * jobs run only in the worker process (see WorkerModule).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        // BullMQ's defaults make `queue.add` wait for Redis indefinitely, which
        // would hang the request enqueueing the job. With these, a command
        // still waits out the connect at boot but rejects after one failed
        // reconnect (about a second) while Redis is down.
        connection: {
          url: config.get("REDIS_URL", { infer: true }),
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
