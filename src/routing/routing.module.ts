import { Module } from '@nestjs/common';
import { SnapshotModule } from '@/snapshot/snapshot.module';
import { CommandHandlers } from './commands/handlers';
import { ModelsController } from './models.controller';
import { QueryHandlers } from './queries/handlers';
import { RoutesController } from './routes.controller';

@Module({
  imports: [SnapshotModule],
  controllers: [ModelsController, RoutesController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class RoutingModule {}
