import { CurrentUser } from "@nestjs/authentication";
import { Body, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import type { User } from "@/users/models/user.js";
import { CreateApiKeyCommand } from "./commands/impl/create-api-key.command.js";
import { RevokeApiKeyCommand } from "./commands/impl/revoke-api-key.command.js";
import type { ApiKeySummary, CreatedApiKey, ModelChoice } from "./models/api-key.js";
import { ListApiKeysQuery } from "./queries/impl/list-api-keys.query.js";
import { ListModelChoicesQuery } from "./queries/impl/list-model-choices.query.js";
import { type NewApiKey, newApiKeySchema } from "./schemas/new-api-key.schema.js";

// A dashboard controller: only a User's session gets in, so an API Key can't manage API Keys.
@DashboardController("api-keys")
export class ApiKeysController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  listApiKeys(): Promise<ApiKeySummary[]> {
    return this.queryBus.execute(new ListApiKeysQuery());
  }

  /** The Models a new key can be restricted to. */
  @Get("model-choices")
  listModelChoices(): Promise<ModelChoice[]> {
    return this.queryBus.execute(new ListModelChoicesQuery());
  }

  @Post()
  createApiKey(
    @Body({ schema: newApiKeySchema }) newKey: NewApiKey,
    @CurrentUser() creator: User,
  ): Promise<CreatedApiKey> {
    return this.commandBus.execute(new CreateApiKeyCommand(newKey, creator.id));
  }

  @Post(":id/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeApiKey(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.commandBus.execute(new RevokeApiKeyCommand(id));
  }
}
