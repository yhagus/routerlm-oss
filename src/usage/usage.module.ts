import { Module } from "@nestjs/common";
import { QueueModule } from "@/queue/queue.module.js";
import { QueryHandlers } from "./queries/handlers/index.js";
import { UsageController } from "./usage.controller.js";
import { UsageProducer } from "./jobs/usage.producer.js";

@Module({
  imports: [QueueModule],
  controllers: [UsageController],
  providers: [UsageProducer, ...QueryHandlers],
  exports: [UsageProducer],
})
export class UsageModule {}
