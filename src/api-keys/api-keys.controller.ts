import { CurrentUser } from "@nestjs/authentication";
import { Body, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import type { User } from "@/users/models/user.js";
import { CreateApiKeyCommand } from "./commands/impl/create-api-key.command.js";
import { RevokeApiKeyCommand } from "./commands/impl/revoke-api-key.command.js";
import { RotateApiKeyCommand } from "./commands/impl/rotate-api-key.command.js";
import { UpdateApiKeyCommand } from "./commands/impl/update-api-key.command.js";
import type {
  ApiKeyRotation,
  ApiKeySummary,
  CreatedApiKey,
  ModelChoice,
} from "./models/api-key.js";
import { ListApiKeyRotationsQuery } from "./queries/impl/list-api-key-rotations.query.js";
import { ListApiKeysQuery } from "./queries/impl/list-api-keys.query.js";
import { ListModelChoicesQuery } from "./queries/impl/list-model-choices.query.js";
import { RevealApiKeyQuery } from "./queries/impl/reveal-api-key.query.js";
import {
  type ApiKeyChanges,
  apiKeyChangesSchema,
  type NewApiKey,
  newApiKeySchema,
} from "./schemas/api-key.schema.js";

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

  /** The whole key again, for the dashboard's Copy. */
  @Get(":id/key")
  revealApiKey(@Param("id", ParseUUIDPipe) id: string): Promise<{ key: string }> {
    return this.queryBus.execute(new RevealApiKeyQuery(id));
  }

  @Patch(":id")
  updateApiKey(
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: apiKeyChangesSchema }) changes: ApiKeyChanges,
  ): Promise<ApiKeySummary> {
    return this.commandBus.execute(new UpdateApiKeyCommand(id, changes));
  }

  // 201 like POST /api-keys: both answer with a newly made key.
  @Post(":id/rotate")
  rotateApiKey(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() rotator: User,
  ): Promise<CreatedApiKey> {
    return this.commandBus.execute(new RotateApiKeyCommand(id, rotator.id));
  }

  /** Every rotation of the key, newest first; revoked keys keep theirs. */
  @Get(":id/rotations")
  listApiKeyRotations(@Param("id", ParseUUIDPipe) id: string): Promise<ApiKeyRotation[]> {
    return this.queryBus.execute(new ListApiKeyRotationsQuery(id));
  }

  @Post(":id/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeApiKey(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.commandBus.execute(new RevokeApiKeyCommand(id));
  }
}
