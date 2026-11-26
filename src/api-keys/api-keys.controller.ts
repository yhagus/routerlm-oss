import { CurrentUser } from '@nestjs/authentication';
import {
  Body,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { DashboardController } from '@/auth/decorators/dashboard-controller.decorator';
import type { User } from '@/users/models/user';
import { CreateApiKeyCommand } from './commands/impl/create-api-key.command';
import { RevokeApiKeyCommand } from './commands/impl/revoke-api-key.command';
import { RotateApiKeyCommand } from './commands/impl/rotate-api-key.command';
import { UpdateApiKeyCommand } from './commands/impl/update-api-key.command';
import type { ApiKeyRotation, ApiKeySummary, CreatedApiKey, ModelChoice } from './models/api-key';
import { ListApiKeyRotationsQuery } from './queries/impl/list-api-key-rotations.query';
import { ListApiKeysQuery } from './queries/impl/list-api-keys.query';
import { ListModelChoicesQuery } from './queries/impl/list-model-choices.query';
import { RevealApiKeyQuery } from './queries/impl/reveal-api-key.query';
import {
  type ApiKeyChanges,
  apiKeyChangesSchema,
  type ApiKeyListQuery,
  apiKeyListQuerySchema,
  type NewApiKey,
  newApiKeySchema,
} from './schemas/api-key.schema';

@DashboardController('api-keys')
export class ApiKeysController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  listApiKeys(
    @Query({ schema: apiKeyListQuerySchema }) filter: ApiKeyListQuery,
  ): Promise<ApiKeySummary[]> {
    return this.queryBus.execute(new ListApiKeysQuery(filter));
  }

  @Get('model-choices')
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

  @Get(':id/key')
  revealApiKey(@Param('id', ParseUUIDPipe) id: string): Promise<{ key: string }> {
    return this.queryBus.execute(new RevealApiKeyQuery(id));
  }

  @Patch(':id')
  updateApiKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: apiKeyChangesSchema }) changes: ApiKeyChanges,
  ): Promise<ApiKeySummary> {
    return this.commandBus.execute(new UpdateApiKeyCommand(id, changes));
  }

  @Post(':id/rotate')
  rotateApiKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() rotator: User,
  ): Promise<CreatedApiKey> {
    return this.commandBus.execute(new RotateApiKeyCommand(id, rotator.id));
  }

  @Get(':id/rotations')
  listApiKeyRotations(@Param('id', ParseUUIDPipe) id: string): Promise<ApiKeyRotation[]> {
    return this.queryBus.execute(new ListApiKeyRotationsQuery(id));
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeApiKey(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.commandBus.execute(new RevokeApiKeyCommand(id));
  }
}
