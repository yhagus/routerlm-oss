import { Body, Delete, Get, Put, Query } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import { ChangeErrorCaptureRetentionCommand } from "./commands/impl/change-error-capture-retention.command.js";
import { ChangeTermsRiskProvidersCommand } from "./commands/impl/change-terms-risk-providers.command.js";
import { ResetErrorCaptureRetentionCommand } from "./commands/impl/reset-error-capture-retention.command.js";
import { ResetTermsRiskProvidersCommand } from "./commands/impl/reset-terms-risk-providers.command.js";
import type {
  ErrorCaptureRetention,
  ErrorCaptureRetentionImpact,
} from "./models/error-capture-retention.js";
import type { TermsRiskProvidersSetting } from "./models/terms-risk-providers.js";
import { CountCapturesExpiredByQuery } from "./queries/impl/count-captures-expired-by.query.js";
import { ShowErrorCaptureRetentionQuery } from "./queries/impl/show-error-capture-retention.query.js";
import { ShowTermsRiskProvidersQuery } from "./queries/impl/show-terms-risk-providers.query.js";
import {
  type NewRetention,
  newRetentionSchema,
  type RetentionImpactQuery,
  retentionImpactQuerySchema,
} from "./schemas/retention-days.schema.js";
import {
  type NewTermsRiskProviders,
  newTermsRiskProvidersSchema,
} from "./schemas/terms-risk-providers.schema.js";

/** Settings a User changes from the dashboard. Only a User's session gets in. */
@DashboardController("settings")
export class SettingsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get("error-capture-retention")
  showErrorCaptureRetention(): Promise<ErrorCaptureRetention> {
    return this.queryBus.execute(new ShowErrorCaptureRetentionQuery());
  }

  /** What saving `days` would delete, for the confirmation before shortening the period. */
  @Get("error-capture-retention/impact")
  showErrorCaptureRetentionImpact(
    @Query({ schema: retentionImpactQuerySchema }) { days }: RetentionImpactQuery,
  ): Promise<ErrorCaptureRetentionImpact> {
    return this.queryBus.execute(new CountCapturesExpiredByQuery(days));
  }

  @Put("error-capture-retention")
  changeErrorCaptureRetention(
    @Body({ schema: newRetentionSchema }) { days }: NewRetention,
  ): Promise<ErrorCaptureRetention> {
    return this.commandBus.execute(new ChangeErrorCaptureRetentionCommand(days));
  }

  @Delete("error-capture-retention")
  resetErrorCaptureRetention(): Promise<ErrorCaptureRetention> {
    return this.commandBus.execute(new ResetErrorCaptureRetentionCommand());
  }

  @Get("terms-risk-providers")
  showTermsRiskProviders(): Promise<TermsRiskProvidersSetting> {
    return this.queryBus.execute(new ShowTermsRiskProvidersQuery());
  }

  @Put("terms-risk-providers")
  changeTermsRiskProviders(
    @Body({ schema: newTermsRiskProvidersSchema }) { allowed }: NewTermsRiskProviders,
  ): Promise<TermsRiskProvidersSetting> {
    return this.commandBus.execute(new ChangeTermsRiskProvidersCommand(allowed));
  }

  @Delete("terms-risk-providers")
  resetTermsRiskProviders(): Promise<TermsRiskProvidersSetting> {
    return this.commandBus.execute(new ResetTermsRiskProvidersCommand());
  }
}
