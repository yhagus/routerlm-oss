import { CurrentUser } from '@nestjs/authentication';
import {
  Body,
  Delete,
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
import type { ListModelsResponseJson } from '@/control-plane/models/proto-json';
import { DashboardController } from '@/auth/decorators/dashboard-controller.decorator';
import type { User } from '@/users/models/user';
import { CreateIntegrationCommand } from './commands/impl/create-integration.command';
import { DeleteIntegrationCommand } from './commands/impl/delete-integration.command';
import { DisableIntegrationCommand } from './commands/impl/disable-integration.command';
import { EnableIntegrationCommand } from './commands/impl/enable-integration.command';
import { RotateIntegrationSecretCommand } from './commands/impl/rotate-integration-secret.command';
import { UpdateIntegrationCommand } from './commands/impl/update-integration.command';
import type {
  CreatedIntegration,
  IntegrationCustomerPage,
  IntegrationDetail,
  IntegrationRotation,
  IntegrationSummary,
} from './models/integration';
import { GetIntegrationQuery } from './queries/impl/get-integration.query';
import { ListIntegrationCustomersQuery } from './queries/impl/list-integration-customers.query';
import { ListIntegrationOfferedModelsQuery } from './queries/impl/list-integration-offered-models.query';
import { ListIntegrationRotationsQuery } from './queries/impl/list-integration-rotations.query';
import { ListIntegrationsQuery } from './queries/impl/list-integrations.query';
import {
  type IntegrationCustomersQuery,
  integrationCustomersQuerySchema,
} from './schemas/integration-customers-query.schema';
import {
  type IntegrationChanges,
  integrationChangesSchema,
  type NewIntegration,
  newIntegrationSchema,
} from './schemas/integration.schema';

@DashboardController('integrations')
export class IntegrationsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  listIntegrations(): Promise<IntegrationSummary[]> {
    return this.queryBus.execute(new ListIntegrationsQuery());
  }

  @Get(':id')
  getIntegration(@Param('id', ParseUUIDPipe) id: string): Promise<IntegrationDetail> {
    return this.queryBus.execute(new GetIntegrationQuery(id));
  }

  @Get(':id/rotations')
  listIntegrationRotations(@Param('id', ParseUUIDPipe) id: string): Promise<IntegrationRotation[]> {
    return this.queryBus.execute(new ListIntegrationRotationsQuery(id));
  }

  @Get(':id/customers')
  listIntegrationCustomers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: integrationCustomersQuerySchema }) pageQuery: IntegrationCustomersQuery,
  ): Promise<IntegrationCustomerPage> {
    return this.queryBus.execute(new ListIntegrationCustomersQuery(id, pageQuery));
  }

  @Get(':id/models')
  listIntegrationModels(@Param('id', ParseUUIDPipe) id: string): Promise<ListModelsResponseJson> {
    return this.queryBus.execute(new ListIntegrationOfferedModelsQuery(id));
  }

  @Post()
  createIntegration(
    @Body({ schema: newIntegrationSchema }) newIntegration: NewIntegration,
    @CurrentUser() creator: User,
  ): Promise<CreatedIntegration> {
    return this.commandBus.execute(new CreateIntegrationCommand(newIntegration, creator.id));
  }

  @Patch(':id')
  updateIntegration(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: integrationChangesSchema }) changes: IntegrationChanges,
  ): Promise<IntegrationSummary> {
    return this.commandBus.execute(new UpdateIntegrationCommand(id, changes));
  }

  @Post(':id/rotate')
  rotateIntegrationSecret(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() rotator: User,
  ): Promise<CreatedIntegration> {
    return this.commandBus.execute(new RotateIntegrationSecretCommand(id, rotator.id));
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  disableIntegration(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.commandBus.execute(new DisableIntegrationCommand(id));
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  enableIntegration(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.commandBus.execute(new EnableIntegrationCommand(id));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteIntegration(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.commandBus.execute(new DeleteIntegrationCommand(id));
  }
}
