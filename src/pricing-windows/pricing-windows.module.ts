import { Module } from "@nestjs/common";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { PricingWindowsController } from "./pricing-windows.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";
import { UpstreamModelPricingWindowsController } from "./upstream-model-pricing-windows.controller.js";

@Module({
  imports: [SnapshotModule],
  controllers: [PricingWindowsController, UpstreamModelPricingWindowsController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class PricingWindowsModule {}
