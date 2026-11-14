import { Module } from "@nestjs/common";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { ApiKeyAuth } from "./providers/api-key-auth.js";
import { ApiKeysController } from "./api-keys.controller.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { QueryHandlers } from "./queries/handlers/index.js";

@Module({
  imports: [SnapshotModule],
  controllers: [ApiKeysController],
  providers: [ApiKeyAuth, ...CommandHandlers, ...QueryHandlers],
  exports: [ApiKeyAuth],
})
export class ApiKeysModule {}
