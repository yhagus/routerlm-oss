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
import { DashboardController } from "../auth/dashboard-controller.decorator.js";
import {
  type ListedProviderAccount,
  type ProviderAccount,
  ProviderAccountsService,
} from "./provider-accounts.service.js";
import {
  type NewProviderAccount,
  newProviderAccountSchema,
  type ProviderAccountChanges,
  providerAccountChangesSchema,
} from "./upstream.schemas.js";

@DashboardController("provider-accounts")
export class ProviderAccountsController {
  constructor(private readonly providerAccounts: ProviderAccountsService) {}

  @Get()
  listProviderAccounts(): Promise<ListedProviderAccount[]> {
    return this.providerAccounts.listProviderAccounts();
  }

  @Post()
  createProviderAccount(
    @Body({ schema: newProviderAccountSchema }) newAccount: NewProviderAccount,
  ): Promise<ProviderAccount> {
    return this.providerAccounts.createProviderAccount(newAccount);
  }

  /** Renames, reprioritises, enables or disables a Provider Account, or replaces its key. */
  @Patch(":id")
  updateProviderAccount(
    @Param("id", ParseUUIDPipe) providerAccountId: string,
    @Body({ schema: providerAccountChangesSchema }) changes: ProviderAccountChanges,
  ): Promise<ProviderAccount> {
    return this.providerAccounts.updateProviderAccount(providerAccountId, changes);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProviderAccount(@Param("id", ParseUUIDPipe) providerAccountId: string): Promise<void> {
    return this.providerAccounts.deleteProviderAccount(providerAccountId);
  }
}
