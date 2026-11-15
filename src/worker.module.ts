import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { type Env, envSchema } from "@/config/schemas/env.schema.js";
import { relations } from "@/db/schemas/relations.js";
import {
  ErrorCaptureRetention,
  ErrorCaptureRetentionProcessor,
} from "@/error-captures/jobs/error-capture-retention.js";
import { LibsModule } from "@/libs/libs.module.js";
import { PingProcessor } from "@/queue/jobs/ping.processor.js";
import { QUEUE_NAMES } from "@/queue/models/queue-names.js";
import {
  QuotaReadingSchedule,
  QuotaReadingScheduleProcessor,
} from "@/quota-meters/jobs/quota-reading-schedule.js";
import { QuotaMetersModule } from "@/quota-meters/quota-meters.module.js";
import { UpstreamModule } from "@/upstream/upstream.module.js";
import { UsageWriter } from "@/usage/providers/usage-writer.js";
import { UsageProcessor } from "@/usage/jobs/usage.processor.js";

/**
 * Root module of the worker process (src/worker.ts). Queue processors are
 * providers here and never in AppModule, so jobs run outside the backend.
 */
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
    BullModule.forRootAsync({
      inject: [ConfigService],
      // Unlike the backend's producer connection, workers keep BullMQ's
      // defaults so they wait and reconnect while Redis is down.
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get("REDIS_URL", { infer: true }) },
      }),
    }),
    BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name }))),
    CqrsModule.forRoot(),
    LibsModule,
    // Quota readings mark Provider Accounts Exhausted through UpstreamModule.
    QuotaMetersModule,
    UpstreamModule,
  ],
  providers: [
    PingProcessor,
    UsageProcessor,
    UsageWriter,
    ErrorCaptureRetention,
    ErrorCaptureRetentionProcessor,
    QuotaReadingSchedule,
    QuotaReadingScheduleProcessor,
  ],
})
export class WorkerModule {}
