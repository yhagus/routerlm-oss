import { Module } from "@nestjs/common";
import { SnapshotModule } from "../snapshot/snapshot.module.js";
import { ApiKeyAuth } from "./api-key-auth.js";
import { ApiKeysController } from "./api-keys.controller.js";
import { ApiKeysService } from "./api-keys.service.js";

@Module({
  imports: [SnapshotModule],
  controllers: [ApiKeysController],
  providers: [ApiKeyAuth, ApiKeysService],
  exports: [ApiKeyAuth],
})
export class ApiKeysModule {}
