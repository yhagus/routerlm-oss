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
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "../auth/decorators/dashboard-controller.decorator.js";
import { CreateProviderCommand } from "./commands/impl/create-provider.command.js";
import { DeleteProviderCommand } from "./commands/impl/delete-provider.command.js";
import { UpdateProviderCommand } from "./commands/impl/update-provider.command.js";
import type { Provider } from "./models/provider.js";
import { ListProvidersQuery } from "./queries/impl/list-providers.query.js";
import {
  type NewProvider,
  newProviderSchema,
  type ProviderChanges,
  providerChangesSchema,
} from "./schemas/upstream.schema.js";

@DashboardController("providers")
export class ProvidersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  listProviders(): Promise<Provider[]> {
    return this.queryBus.execute(new ListProvidersQuery());
  }

  @Post()
  createProvider(@Body({ schema: newProviderSchema }) newProvider: NewProvider): Promise<Provider> {
    return this.commandBus.execute(new CreateProviderCommand(newProvider));
  }

  /** Edits a Provider, including enabling or disabling it. */
  @Patch(":id")
  updateProvider(
    @Param("id", ParseUUIDPipe) providerId: string,
    @Body({ schema: providerChangesSchema }) changes: ProviderChanges,
  ): Promise<Provider> {
    return this.commandBus.execute(new UpdateProviderCommand(providerId, changes));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProvider(@Param("id", ParseUUIDPipe) providerId: string): Promise<void> {
    return this.commandBus.execute(new DeleteProviderCommand(providerId));
  }
}
