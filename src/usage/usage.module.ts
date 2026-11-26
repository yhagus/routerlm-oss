import { Module } from "@nestjs/common";
import { QueueModule } from "@/queue/queue.module";
import { QueryHandlers } from "./queries/handlers";
import { UsageController } from "./usage.controller";
import { UsageProducer } from "./jobs/usage.producer";

@Module({
  imports: [QueueModule],
  controllers: [UsageController],
  providers: [UsageProducer, ...QueryHandlers],
  exports: [UsageProducer],
})
export class UsageModule {}
