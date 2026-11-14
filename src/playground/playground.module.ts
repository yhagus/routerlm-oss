import { Module } from "@nestjs/common";
import { InferenceModule } from "../inference/inference.module.js";
import { SnapshotModule } from "../snapshot/snapshot.module.js";
import { PlaygroundController } from "./playground.controller.js";
import { PlaygroundService } from "./playground.service.js";

/** The dashboard's Playground: Users try Models through the client inference path. */
@Module({
  imports: [InferenceModule, SnapshotModule],
  controllers: [PlaygroundController],
  providers: [PlaygroundService],
})
export class PlaygroundModule {}
