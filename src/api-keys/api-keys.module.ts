import { Module } from "@nestjs/common";
import { ApiKeyAuth } from "./api-key-auth.js";
import { ApiKeysController } from "./api-keys.controller.js";
import { ApiKeysService } from "./api-keys.service.js";

@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeyAuth, ApiKeysService],
  exports: [ApiKeyAuth],
})
export class ApiKeysModule {}
