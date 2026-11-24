import { Module } from "@nestjs/common";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { PlaygroundController } from "./playground.controller.js";
import { CommandHandlers } from "./commands/handlers/index.js";

@Module({
  imports: [SnapshotModule],
  controllers: [PlaygroundController],
  providers: [...CommandHandlers],
})
export class PlaygroundModule {}
