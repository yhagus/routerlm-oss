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
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import { CreateProviderAccountCommand } from "./commands/impl/create-provider-account.command.js";
import { DeleteProviderAccountCommand } from "./commands/impl/delete-provider-account.command.js";
import { UpdateProviderAccountCommand } from "./commands/impl/update-provider-account.command.js";
import type { ProviderAccount } from "./models/provider-account.js";
import {
  type ListedProviderAccount,
  ListProviderAccountsQuery,
} from "./queries/impl/list-provider-accounts.query.js";
import {
  type NewProviderAccount,
  newProviderAccountSchema,
  type ProviderAccountChanges,
  providerAccountChangesSchema,
} from "./schemas/upstream.schema.js";

@DashboardController("provider-accounts")
export class ProviderAccountsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  listProviderAccounts(): Promise<ListedProviderAccount[]> {
    return this.queryBus.execute(new ListProviderAccountsQuery());
  }

  @Post()
  createProviderAccount(
    @Body({ schema: newProviderAccountSchema }) newAccount: NewProviderAccount,
  ): Promise<ProviderAccount> {
    return this.commandBus.execute(new CreateProviderAccountCommand(newAccount));
  }

  @Patch(":id")
  updateProviderAccount(
    @Param("id", ParseUUIDPipe) providerAccountId: string,
    @Body({ schema: providerAccountChangesSchema }) changes: ProviderAccountChanges,
  ): Promise<ProviderAccount> {
    return this.commandBus.execute(new UpdateProviderAccountCommand(providerAccountId, changes));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProviderAccount(@Param("id", ParseUUIDPipe) providerAccountId: string): Promise<void> {
    return this.commandBus.execute(new DeleteProviderAccountCommand(providerAccountId));
  }
}
