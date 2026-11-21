import { CurrentUser } from "@nestjs/authentication";
import { Body, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import type { User } from "@/users/models/user.js";
import { CreateIntegrationCommand } from "./commands/impl/create-integration.command.js";
import { RotateIntegrationSecretCommand } from "./commands/impl/rotate-integration-secret.command.js";
import { UpdateIntegrationCommand } from "./commands/impl/update-integration.command.js";
import type { CreatedIntegration, IntegrationSummary } from "./models/integration.js";
import { ListIntegrationsQuery } from "./queries/impl/list-integrations.query.js";
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
}
