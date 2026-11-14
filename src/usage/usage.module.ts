import { Module } from "@nestjs/common";
import { QueueModule } from "../queue/queue.module.js";
import { UsageController } from "./usage.controller.js";
import { UsageProducer } from "./usage.producer.js";
import { UsageService } from "./usage.service.js";

/**
 * The backend's side of usage: enqueueing each request's measurements, and
 * the Usage page's API. The worker writes them (UsageProcessor, in
 * WorkerModule only).
 */
@Module({
  imports: [QueueModule],
  controllers: [UsageController],
  providers: [UsageProducer, UsageService],
  exports: [UsageProducer],
})
export class UsageModule {}
