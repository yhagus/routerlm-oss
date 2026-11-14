import { CurrentUser } from "@nestjs/authentication";
import { Body, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { DashboardController } from "../auth/dashboard-controller.decorator.js";
import type { User } from "../users/user.js";
import type { ApiKeySummary, CreatedApiKey, ModelChoice } from "./api-key.js";
import { type NewApiKey, newApiKeySchema } from "./api-keys.schemas.js";
import { ApiKeysService } from "./api-keys.service.js";

// A dashboard controller: only a User's session gets in, so an API Key can't manage API Keys.
@DashboardController("api-keys")
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  listApiKeys(): Promise<ApiKeySummary[]> {
    return this.apiKeys.listApiKeys();
  }

  /** The Models a new key can be restricted to. */
  @Get("model-choices")
  listModelChoices(): Promise<ModelChoice[]> {
    return this.apiKeys.listModelChoices();
  }

  @Post()
  createApiKey(
    @Body({ schema: newApiKeySchema }) newKey: NewApiKey,
    @CurrentUser() creator: User,
  ): Promise<CreatedApiKey> {
    return this.apiKeys.createApiKey(newKey, creator.id);
  }

  @Post(":id/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeApiKey(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.apiKeys.revokeApiKey(id);
  }
}
