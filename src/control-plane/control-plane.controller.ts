import { Authenticate, CurrentUser } from '@nestjs/authentication';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { IntegrationPrincipal } from '@/integrations/models/integration';
import { IntegrationSecretAuth } from '@/integrations/providers/integration-secret-auth';
import { CreateCustomerApiKeyCommand } from './commands/impl/create-customer-api-key.command';
import { RevokeCustomerApiKeyCommand } from './commands/impl/revoke-customer-api-key.command';
import { RotateCustomerApiKeyCommand } from './commands/impl/rotate-customer-api-key.command';
import { UpdateCustomerApiKeyCommand } from './commands/impl/update-customer-api-key.command';
import { ControlPlaneExceptionFilter } from './filters/control-plane-exception.filter';
import {
  type ApiKeyJson,
  apiKeyJsonOf,
  type IssuedKeyJson,
  issuedKeyJsonOf,
  type ListKeysResponseJson,
  type ListModelsResponseJson,
  type ListUsageLogsResponseJson,
  listKeysResponseJsonOf,
  listModelsResponseJsonOf,
  listUsageLogsResponseJsonOf,
} from './models/proto-json';
import { GetCustomerApiKeyQuery } from './queries/impl/get-customer-api-key.query';
import { ListCustomerApiKeysQuery } from './queries/impl/list-customer-api-keys.query';
import { ListIntegrationModelsQuery } from './queries/impl/list-integration-models.query';
import { ListIntegrationUsageLogsQuery } from './queries/impl/list-integration-usage-logs.query';
import {
  type CustomerApiKeyChanges,
  customerApiKeyChangesSchema,
  type CustomerApiKeyPageQuery,
  customerApiKeyPageQuerySchema,
  type NewCustomerApiKey,
  newCustomerApiKeySchema,
} from './schemas/customer-api-key.schema';
import { type UsageLogPageQuery, usageLogPageQuerySchema } from './schemas/usage-log.schema';

export const CONTROL_PLANE_HTTP_PREFIX = 'integration/v1';

@Controller(CONTROL_PLANE_HTTP_PREFIX)
@Authenticate({ providers: [IntegrationSecretAuth] })
@UseFilters(ControlPlaneExceptionFilter)
export class ControlPlaneController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('keys')
  async createKey(
    @CurrentUser() integration: IntegrationPrincipal,
    @Body({ schema: newCustomerApiKeySchema }) newKey: NewCustomerApiKey,
  ): Promise<IssuedKeyJson> {
    const issued = await this.commandBus.execute(
      new CreateCustomerApiKeyCommand(integration, newKey),
    );
    return issuedKeyJsonOf(issued);
  }

  @Get('keys')
  async listKeys(
    @CurrentUser() integration: IntegrationPrincipal,
    @Query({ schema: customerApiKeyPageQuerySchema }) page: CustomerApiKeyPageQuery,
  ): Promise<ListKeysResponseJson> {
    const keys = await this.queryBus.execute(new ListCustomerApiKeysQuery(integration, page));
    return listKeysResponseJsonOf(keys);
  }

  @Get('keys/:id')
  async getKey(
    @CurrentUser() integration: IntegrationPrincipal,
    @Param('id') id: string,
  ): Promise<ApiKeyJson> {
    const apiKey = await this.queryBus.execute(new GetCustomerApiKeyQuery(integration, id));
    return apiKeyJsonOf(apiKey);
  }

  @Patch('keys/:id')
  async updateKey(
    @CurrentUser() integration: IntegrationPrincipal,
    @Param('id') id: string,
    @Body({ schema: customerApiKeyChangesSchema }) changes: CustomerApiKeyChanges,
  ): Promise<ApiKeyJson> {
    const apiKey = await this.commandBus.execute(
      new UpdateCustomerApiKeyCommand(integration, id, changes),
    );
    return apiKeyJsonOf(apiKey);
  }

  @Post('keys/:id/rotate')
  @HttpCode(HttpStatus.OK)
  async rotateKey(
    @CurrentUser() integration: IntegrationPrincipal,
    @Param('id') id: string,
  ): Promise<IssuedKeyJson> {
    const issued = await this.commandBus.execute(new RotateCustomerApiKeyCommand(integration, id));
    return issuedKeyJsonOf(issued);
  }

  @Post('keys/:id/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeKey(
    @CurrentUser() integration: IntegrationPrincipal,
    @Param('id') id: string,
  ): Promise<ApiKeyJson> {
    const apiKey = await this.commandBus.execute(new RevokeCustomerApiKeyCommand(integration, id));
    return apiKeyJsonOf(apiKey);
  }

  @Get('models')
  async listModels(
    @CurrentUser() integration: IntegrationPrincipal,
  ): Promise<ListModelsResponseJson> {
    const models = await this.queryBus.execute(new ListIntegrationModelsQuery(integration));
    return listModelsResponseJsonOf(models);
  }

  @Get('usage-logs')
  async listUsageLogs(
    @CurrentUser() integration: IntegrationPrincipal,
    @Query({ schema: usageLogPageQuerySchema }) page: UsageLogPageQuery,
  ): Promise<ListUsageLogsResponseJson> {
    const usageLogs = await this.queryBus.execute(
      new ListIntegrationUsageLogsQuery(integration, page),
    );
    return listUsageLogsResponseJsonOf(usageLogs);
  }
}
