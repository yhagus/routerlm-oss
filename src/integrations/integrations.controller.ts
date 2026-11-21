import { CurrentUser } from "@nestjs/authentication";
import { Body, Get, Post } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import type { User } from "@/users/models/user.js";
import { CreateIntegrationCommand } from "./commands/impl/create-integration.command.js";
import type { CreatedIntegration, IntegrationSummary } from "./models/integration.js";
import { ListIntegrationsQuery } from "./queries/impl/list-integrations.query.js";
import { type NewIntegration, newIntegrationSchema } from "./schemas/integration.schema.js";

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
}
