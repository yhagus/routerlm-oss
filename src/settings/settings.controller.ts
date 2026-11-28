import { Body, Delete, Get, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { DashboardController } from '@/auth/decorators/dashboard-controller.decorator';
import { ChangeConcurrencyWaitCommand } from './commands/impl/change-concurrency-wait.command';
import { ChangeErrorCaptureRetentionCommand } from './commands/impl/change-error-capture-retention.command';
import { ChangePrivateUpstreamsCommand } from './commands/impl/change-private-upstreams.command';
import { ChangeTermsRiskProvidersCommand } from './commands/impl/change-terms-risk-providers.command';
import { ResetConcurrencyWaitCommand } from './commands/impl/reset-concurrency-wait.command';
import { ResetErrorCaptureRetentionCommand } from './commands/impl/reset-error-capture-retention.command';
import { ResetPrivateUpstreamsCommand } from './commands/impl/reset-private-upstreams.command';
import { ResetTermsRiskProvidersCommand } from './commands/impl/reset-terms-risk-providers.command';
import type { ConcurrencyWaitSetting } from './models/concurrency-wait';
import type {
  ErrorCaptureRetention,
  ErrorCaptureRetentionImpact,
} from './models/error-capture-retention';
import type { PrivateUpstreamsSetting } from './models/private-upstreams';
import type { TermsRiskProvidersSetting } from './models/terms-risk-providers';
import { CountCapturesExpiredByQuery } from './queries/impl/count-captures-expired-by.query';
import { ShowConcurrencyWaitQuery } from './queries/impl/show-concurrency-wait.query';
import { ShowErrorCaptureRetentionQuery } from './queries/impl/show-error-capture-retention.query';
import { ShowPrivateUpstreamsQuery } from './queries/impl/show-private-upstreams.query';
import { ShowTermsRiskProvidersQuery } from './queries/impl/show-terms-risk-providers.query';
import {
  type NewConcurrencyWait,
  newConcurrencyWaitSchema,
} from './schemas/concurrency-wait.schema';
import {
  type NewPrivateUpstreams,
  newPrivateUpstreamsSchema,
} from './schemas/private-upstreams.schema';
import {
  type NewRetention,
  newRetentionSchema,
  type RetentionImpactQuery,
  retentionImpactQuerySchema,
} from './schemas/retention-days.schema';
import {
  type NewTermsRiskProviders,
  newTermsRiskProvidersSchema,
} from './schemas/terms-risk-providers.schema';

@DashboardController('settings')
export class SettingsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('error-capture-retention')
  showErrorCaptureRetention(): Promise<ErrorCaptureRetention> {
    return this.queryBus.execute(new ShowErrorCaptureRetentionQuery());
  }

  @Get('error-capture-retention/impact')
  showErrorCaptureRetentionImpact(
    @Query({ schema: retentionImpactQuerySchema }) { days }: RetentionImpactQuery,
  ): Promise<ErrorCaptureRetentionImpact> {
    return this.queryBus.execute(new CountCapturesExpiredByQuery(days));
  }

  @Put('error-capture-retention')
  changeErrorCaptureRetention(
    @Body({ schema: newRetentionSchema }) { days }: NewRetention,
  ): Promise<ErrorCaptureRetention> {
    return this.commandBus.execute(new ChangeErrorCaptureRetentionCommand(days));
  }

  @Delete('error-capture-retention')
  resetErrorCaptureRetention(): Promise<ErrorCaptureRetention> {
    return this.commandBus.execute(new ResetErrorCaptureRetentionCommand());
  }

  @Get('terms-risk-providers')
  showTermsRiskProviders(): Promise<TermsRiskProvidersSetting> {
    return this.queryBus.execute(new ShowTermsRiskProvidersQuery());
  }

  @Put('terms-risk-providers')
  changeTermsRiskProviders(
    @Body({ schema: newTermsRiskProvidersSchema }) { allowed }: NewTermsRiskProviders,
  ): Promise<TermsRiskProvidersSetting> {
    return this.commandBus.execute(new ChangeTermsRiskProvidersCommand(allowed));
  }

  @Delete('terms-risk-providers')
  resetTermsRiskProviders(): Promise<TermsRiskProvidersSetting> {
    return this.commandBus.execute(new ResetTermsRiskProvidersCommand());
  }

  @Get('private-upstreams')
  showPrivateUpstreams(): Promise<PrivateUpstreamsSetting> {
    return this.queryBus.execute(new ShowPrivateUpstreamsQuery());
  }

  @Put('private-upstreams')
  changePrivateUpstreams(
    @Body({ schema: newPrivateUpstreamsSchema }) { allowed }: NewPrivateUpstreams,
  ): Promise<PrivateUpstreamsSetting> {
    return this.commandBus.execute(new ChangePrivateUpstreamsCommand(allowed));
  }

  @Delete('private-upstreams')
  resetPrivateUpstreams(): Promise<PrivateUpstreamsSetting> {
    return this.commandBus.execute(new ResetPrivateUpstreamsCommand());
  }

  @Get('concurrency-wait')
  showConcurrencyWait(): Promise<ConcurrencyWaitSetting> {
    return this.queryBus.execute(new ShowConcurrencyWaitQuery());
  }

  @Put('concurrency-wait')
  changeConcurrencyWait(
    @Body({ schema: newConcurrencyWaitSchema }) { seconds }: NewConcurrencyWait,
  ): Promise<ConcurrencyWaitSetting> {
    return this.commandBus.execute(new ChangeConcurrencyWaitCommand(seconds));
  }

  @Delete('concurrency-wait')
  resetConcurrencyWait(): Promise<ConcurrencyWaitSetting> {
    return this.commandBus.execute(new ResetConcurrencyWaitCommand());
  }
}
