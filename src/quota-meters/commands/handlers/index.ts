import { ReadProviderAccountQuotaHandler } from './read-provider-account-quota.handler';
import { RefreshUsageResetsHandler } from './refresh-usage-resets.handler';
import { UseUsageResetHandler } from './use-usage-reset.handler';

export const CommandHandlers = [
  ReadProviderAccountQuotaHandler,
  RefreshUsageResetsHandler,
  UseUsageResetHandler,
];
