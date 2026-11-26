import { Module } from "@nestjs/common";
import { SnapshotModule } from "@/snapshot/snapshot.module";
import { PlaygroundController } from "./playground.controller";
import { CommandHandlers } from "./commands/handlers";

@Module({
  imports: [SnapshotModule],
  controllers: [PlaygroundController],
  providers: [...CommandHandlers],
})
export class PlaygroundModule {}
