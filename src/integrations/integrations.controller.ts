import { CurrentUser } from "@nestjs/authentication";
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
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { ListModelsResponseJson } from "@/control-plane/models/proto-json.js";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import type { User } from "@/users/models/user.js";
import { CreateIntegrationCommand } from "./commands/impl/create-integration.command.js";
import { DeleteIntegrationCommand } from "./commands/impl/delete-integration.command.js";
import { DisableIntegrationCommand } from "./commands/impl/disable-integration.command.js";
import { EnableIntegrationCommand } from "./commands/impl/enable-integration.command.js";
import { RotateIntegrationSecretCommand } from "./commands/impl/rotate-integration-secret.command.js";
import { UpdateIntegrationCommand } from "./commands/impl/update-integration.command.js";
import type {
  CreatedIntegration,
  IntegrationCustomerPage,
  IntegrationDetail,
  IntegrationRotation,
  IntegrationSummary,
} from "./models/integration.js";
import { GetIntegrationQuery } from "./queries/impl/get-integration.query.js";
import { ListIntegrationCustomersQuery } from "./queries/impl/list-integration-customers.query.js";
import { ListIntegrationOfferedModelsQuery } from "./queries/impl/list-integration-offered-models.query.js";
import { ListIntegrationRotationsQuery } from "./queries/impl/list-integration-rotations.query.js";
import { ListIntegrationsQuery } from "./queries/impl/list-integrations.query.js";
import {
  type IntegrationCustomersQuery,
  integrationCustomersQuerySchema,
} from "./schemas/integration-customers-query.schema.js";
import {
  type IntegrationChanges,
  integrationChangesSchema,
  type NewIntegration,
  newIntegrationSchema,
} from "./schemas/integration.schema.js";

// A dashboard controller: only a User's session gets in, never an Integration Secret or API Key.
@DashboardController("integrations")
export class IntegrationsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  listIntegrations(): Promise<IntegrationSummary[]> {
    return this.queryBus.execute(new ListIntegrationsQuery());
  }

  @Get(":id")
  getIntegration(@Param("id", ParseUUIDPipe) id: string): Promise<IntegrationDetail> {
    return this.queryBus.execute(new GetIntegrationQuery(id));
  }

  /** Every rotation of the Integration Secret, newest first. */
  @Get(":id/rotations")
  listIntegrationRotations(@Param("id", ParseUUIDPipe) id: string): Promise<IntegrationRotation[]> {
    return this.queryBus.execute(new ListIntegrationRotationsQuery(id));
  }

  /** The Customers named on its API Keys, rolled up over all time, most recently active first. */
  @Get(":id/customers")
  listIntegrationCustomers(
    @Param("id", ParseUUIDPipe) id: string,
    @Query({ schema: integrationCustomersQuerySchema }) pageQuery: IntegrationCustomersQuery,
  ): Promise<IntegrationCustomerPage> {
    return this.queryBus.execute(new ListIntegrationCustomersQuery(id, pageQuery));
  }

  /** The Models it may sell, exactly as its control plane's ListModels answers it. */
  @Get(":id/models")
  listIntegrationModels(@Param("id", ParseUUIDPipe) id: string): Promise<ListModelsResponseJson> {
    return this.queryBus.execute(new ListIntegrationOfferedModelsQuery(id));
  }

  @Post()
  createIntegration(
    @Body({ schema: newIntegrationSchema }) newIntegration: NewIntegration,
    @CurrentUser() creator: User,
  ): Promise<CreatedIntegration> {
    return this.commandBus.execute(new CreateIntegrationCommand(newIntegration, creator.id));
  }

  /** Renames the Integration or changes its allowed Models; an empty list means every Model. */
  @Patch(":id")
  updateIntegration(
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: integrationChangesSchema }) changes: IntegrationChanges,
  ): Promise<IntegrationSummary> {
    return this.commandBus.execute(new UpdateIntegrationCommand(id, changes));
  }

  // 201 like POST /integrations: both answer with a newly made secret.
  @Post(":id/rotate")
  rotateIntegrationSecret(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() rotator: User,
  ): Promise<CreatedIntegration> {
    return this.commandBus.execute(new RotateIntegrationSecretCommand(id, rotator.id));
  }

  @Post(":id/disable")
  @HttpCode(HttpStatus.NO_CONTENT)
  disableIntegration(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.commandBus.execute(new DisableIntegrationCommand(id));
  }

  @Post(":id/enable")
  @HttpCode(HttpStatus.NO_CONTENT)
  enableIntegration(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.commandBus.execute(new EnableIntegrationCommand(id));
  }

  /** Deletes the Integration for good, revoking every API Key it issued. Disable it to suspend instead. */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteIntegration(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.commandBus.execute(new DeleteIntegrationCommand(id));
  }
}
