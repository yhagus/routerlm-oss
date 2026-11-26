import { GetCustomerApiKeyHandler } from './get-customer-api-key.handler';
import { ListCustomerApiKeysHandler } from './list-customer-api-keys.handler';
import { ListIntegrationModelsHandler } from './list-integration-models.handler';
import { ListIntegrationUsageLogsHandler } from './list-integration-usage-logs.handler';

export const QueryHandlers = [
  GetCustomerApiKeyHandler,
  ListCustomerApiKeysHandler,
  ListIntegrationModelsHandler,
  ListIntegrationUsageLogsHandler,
];
