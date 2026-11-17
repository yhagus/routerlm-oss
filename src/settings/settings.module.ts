import { Module } from "@nestjs/common";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { SettingsStore } from "./providers/settings-store.js";
import { QueryHandlers } from "./queries/handlers/index.js";
import { SettingsController } from "./settings.controller.js";

/** Settings a User changes from the dashboard, kept in the database (ADR 0017). */
@Module({
  imports: [SnapshotModule],
  controllers: [SettingsController],
  providers: [SettingsStore, ...CommandHandlers, ...QueryHandlers],
})
export class SettingsModule {}
