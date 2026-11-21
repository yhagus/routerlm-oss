import { GetCustomerApiKeyHandler } from "./get-customer-api-key.handler.js";
import { ListCustomerApiKeysHandler } from "./list-customer-api-keys.handler.js";
import { ListIntegrationModelsHandler } from "./list-integration-models.handler.js";
import { ListIntegrationUsageLogsHandler } from "./list-integration-usage-logs.handler.js";

export const QueryHandlers = [
  GetCustomerApiKeyHandler,
  ListCustomerApiKeysHandler,
  ListIntegrationModelsHandler,
  ListIntegrationUsageLogsHandler,
];
