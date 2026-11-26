import { Module } from '@nestjs/common';
import { SnapshotModule } from '@/snapshot/snapshot.module';
import { CommandHandlers } from './commands/handlers';
import { SettingsStore } from './providers/settings-store';
import { QueryHandlers } from './queries/handlers';
import { SettingsController } from './settings.controller';

@Module({
  imports: [SnapshotModule],
  controllers: [SettingsController],
  providers: [SettingsStore, ...CommandHandlers, ...QueryHandlers],
})
export class SettingsModule {}
