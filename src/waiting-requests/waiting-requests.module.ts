import { Module } from '@nestjs/common';
import { RedisModule } from '@/redis/redis.module';
import { QueryHandlers } from './queries/handlers';
import { WaitingLines } from './providers/waiting-lines';
import { WaitingRequestsController } from './waiting-requests.controller';

@Module({
  imports: [RedisModule],
  controllers: [WaitingRequestsController],
  providers: [WaitingLines, ...QueryHandlers],
})
export class WaitingRequestsModule {}
