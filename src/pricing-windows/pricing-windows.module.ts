import { Module } from '@nestjs/common';
import { SnapshotModule } from '@/snapshot/snapshot.module';
import { CommandHandlers } from './commands/handlers';
import { PricingWindowsController } from './pricing-windows.controller';
import { QueryHandlers } from './queries/handlers';
import { UpstreamModelPricingWindowsController } from './upstream-model-pricing-windows.controller';

@Module({
  imports: [SnapshotModule],
  controllers: [PricingWindowsController, UpstreamModelPricingWindowsController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class PricingWindowsModule {}
