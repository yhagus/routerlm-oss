import { Module } from '@nestjs/common';
import { SnapshotModule } from '@/snapshot/snapshot.module';
import { CommandHandlers } from './commands/handlers';
import { ModelGroupsController } from './model-groups.controller';
import { QueryHandlers } from './queries/handlers';

@Module({
  imports: [SnapshotModule],
  controllers: [ModelGroupsController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class ModelGroupsModule {}
