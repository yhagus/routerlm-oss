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
import { type Provider, ProvidersService } from "./providers.service.js";
import {
  type NewProvider,
  newProviderSchema,
  type ProviderChanges,
  providerChangesSchema,
} from "./upstream.schemas.js";

@DashboardController("providers")
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  listProviders(): Promise<Provider[]> {
    return this.providers.listProviders();
  }

  @Post()
  createProvider(@Body({ schema: newProviderSchema }) newProvider: NewProvider): Promise<Provider> {
    return this.providers.createProvider(newProvider);
  }

  /** Edits a Provider, including enabling or disabling it. */
  @Patch(":id")
  updateProvider(
    @Param("id", ParseUUIDPipe) providerId: string,
    @Body({ schema: providerChangesSchema }) changes: ProviderChanges,
  ): Promise<Provider> {
    return this.providers.updateProvider(providerId, changes);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProvider(@Param("id", ParseUUIDPipe) providerId: string): Promise<void> {
    return this.providers.deleteProvider(providerId);
  }
}
