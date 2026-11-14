import { Module } from "@nestjs/common";
import { QueueModule } from "../queue/queue.module.js";
import { UsageProducer } from "./usage.producer.js";

/**
 * The backend's side of usage: enqueueing each request's measurements. The
 * worker writes them (UsageProcessor, in WorkerModule only).
 */
@Module({
  imports: [QueueModule],
  providers: [UsageProducer],
  exports: [UsageProducer],
})
export class UsageModule {}
