import { ReadProviderAccountQuotaHandler } from "./read-provider-account-quota.handler.js";
import { RefreshUsageResetsHandler } from "./refresh-usage-resets.handler.js";
import { UseUsageResetHandler } from "./use-usage-reset.handler.js";

export const CommandHandlers = [
  ReadProviderAccountQuotaHandler,
  RefreshUsageResetsHandler,
  UseUsageResetHandler,
];
