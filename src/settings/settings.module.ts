import { Module } from '@nestjs/common';
import { CommandHandlers } from './commands/handlers';
import { SettingsStore } from './providers/settings-store';
import { QueryHandlers } from './queries/handlers';
import { SettingsController } from './settings.controller';

@Module({
  controllers: [SettingsController],
  providers: [SettingsStore, ...CommandHandlers, ...QueryHandlers],
  exports: [SettingsStore],
})
export class SettingsModule {}
