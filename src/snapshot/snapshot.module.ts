import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from '@/redis/redis.module';
import { CommandHandlers } from './commands/handlers';
import { SnapshotService } from './providers/snapshot.service';

@Module({
  imports: [RedisModule, ScheduleModule.forRoot()],
  providers: [SnapshotService, ...CommandHandlers],
  exports: [SnapshotService],
})
export class SnapshotModule {}
