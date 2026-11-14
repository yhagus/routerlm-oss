import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { type Env, envSchema } from "./config/env.schema.js";
import { PingProcessor } from "./queue/ping.processor.js";
import { QUEUE_NAMES } from "./queue/queue-names.js";

/**
 * Root module of the worker process (src/worker.ts). Queue processors are
 * providers here and never in AppModule, so jobs run outside the backend.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      // Unlike the backend's producer connection, workers keep BullMQ's
      // defaults so they wait and reconnect while Redis is down.
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get("REDIS_URL", { infer: true }) },
      }),
    }),
    BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name }))),
  ],
  providers: [PingProcessor],
})
export class WorkerModule {}
